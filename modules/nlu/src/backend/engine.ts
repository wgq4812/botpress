import { MLToolkit, NLU } from 'botpress/sdk'
import _ from 'lodash'
import crypto from 'crypto'

import * as CacheManager from './cache-manager'
import { computeModelHash, Model } from './model-service'
import { Predict, PredictInput, Predictors, PredictOutput } from './predict-pipeline'
import SlotTagger from './slots/slot-tagger'
import { isPatternValid } from './tools/patterns-utils'
import { computeKmeans, ProcessIntents, Trainer, TrainInput, TrainOutput } from './training-pipeline'
import {
  EntityCacheDump,
  ListEntity,
  ListEntityModel,
  NLUEngine,
  Tools,
  TrainingSession,
  NLUVersionInfo,
  Intent
} from './typings'

const trainDebug = DEBUG('nlu').sub('training')

export type TrainingOptions = {
  forceTrain: boolean
}

export default class Engine implements NLUEngine {
  // NOTE: removed private in order to prevent important refactor (which will be done later)
  static tools: Tools
  private predictorsByLang: _.Dictionary<Predictors> = {}
  private modelsByLang: _.Dictionary<Model> = {}

  constructor(private defaultLanguage: string, private botId: string, private version: NLUVersionInfo) {}

  static provideTools(tools: Tools) {
    Engine.tools = tools
  }

  async train(
    intentDefs: NLU.IntentDefinition[],
    entityDefs: NLU.EntityDefinition[],
    languageCode: string,
    trainingSession?: TrainingSession,
    options?: TrainingOptions
  ): Promise<Model> {
    trainDebug.forBot(this.botId, `Started ${languageCode} training`)

    const list_entities = entityDefs
      .filter(ent => ent.type === 'list')
      .map(e => {
        return {
          name: e.name,
          fuzzyTolerance: e.fuzzy,
          sensitive: e.sensitive,
          synonyms: _.chain(e.occurrences)
            .keyBy('name')
            .mapValues('synonyms')
            .value()
        } as ListEntity
      })

    const pattern_entities = entityDefs
      .filter(ent => ent.type === 'pattern' && isPatternValid(ent.pattern))
      .map(ent => ({
        name: ent.name,
        pattern: ent.pattern,
        examples: [], // TODO add this to entityDef
        matchCase: ent.matchCase,
        sensitive: ent.sensitive
      }))

    const contexts = _.chain(intentDefs)
      .flatMap(i => i.contexts)
      .uniq()
      .value()

    const intents = intentDefs
      .filter(x => !!x.utterances[languageCode])
      .map(x => ({
        name: x.name,
        contexts: x.contexts,
        utterances: x.utterances[languageCode],
        slot_definitions: x.slots
      }))

    const previousModel = this.modelsByLang[languageCode]
    let trainAllCtx = options?.forceTrain || !previousModel
    let ctxToTrain = contexts

    if (!trainAllCtx) {
      const previousIntents = previousModel.data.input.intents
      const ctxHasChanged = this._ctxHasChanged(previousIntents, intents)
      const modifiedCtx = contexts.filter(ctxHasChanged)

      trainAllCtx = modifiedCtx.length === contexts.length
      ctxToTrain = trainAllCtx ? contexts : modifiedCtx
    }

    const debugMsg = trainAllCtx
      ? `Training all contexts for language: ${languageCode}`
      : `Retraining only contexts: [${ctxToTrain}] for language: ${languageCode}`
    trainDebug.forBot(this.botId, debugMsg)

    const input: TrainInput = {
      botId: this.botId,
      trainingSession,
      languageCode,
      list_entities,
      pattern_entities,
      contexts,
      intents,
      ctxToTrain
    }

    // Model should be build here, Trainer should not have any idea of how this is stored
    // Error handling should be done here
    let model = await Trainer(input, Engine.tools)
    if (!trainAllCtx) {
      model = this._mergeModels(previousModel, model)
    }

    model.hash = computeModelHash(intentDefs, entityDefs, this.version, model.languageCode)
    if (model.success) {
      trainingSession &&
        Engine.tools.reportTrainingProgress(this.botId, 'Training complete', {
          ...trainingSession,
          progress: 1,
          status: 'done'
        })

      trainDebug.forBot(this.botId, `Successfully finished ${languageCode} training`)
    }

    return model
  }

  private modelAlreadyLoaded(model: Model) {
    if (!model?.languageCode) {
      return false
    }
    const lang = model.languageCode

    return (
      !!this.predictorsByLang[lang] &&
      !!this.modelsByLang[lang] &&
      !!this.modelsByLang[lang].hash &&
      !!model.hash &&
      this.modelsByLang[lang].hash === model.hash
    )
  }

  async loadModel(model: Model) {
    if (this.modelAlreadyLoaded(model)) {
      return
    }
    if (!model.data.output) {
      const intents = await ProcessIntents(
        model.data.input.intents,
        model.languageCode,
        model.data.artefacts.list_entities,
        Engine.tools
      )
      model.data.output = { intents } as TrainOutput
    }

    this._warmEntitiesCaches(_.get(model, 'data.artefacts.list_entities', []))
    this.predictorsByLang[model.languageCode] = await this._makePredictors(model)
    this.modelsByLang[model.languageCode] = model
  }

  private _warmEntitiesCaches(listEntities: ListEntityModel[]) {
    for (const entity of listEntities) {
      if (!entity.cache) {
        // when loading a model trained in a previous version
        entity.cache = CacheManager.getOrCreateCache(entity.entityName, this.botId)
      }
      if (CacheManager.isCacheDump(entity.cache)) {
        entity.cache = CacheManager.loadCacheFromData(<EntityCacheDump>entity.cache, entity.entityName, this.botId)
      }
    }
  }

  private async _makePredictors(model: Model): Promise<Predictors> {
    const { input, output, artefacts } = model.data
    const tools = Engine.tools

    if (_.flatMap(input.intents, i => i.utterances).length <= 0) {
      // we don't want to return undefined as extraction won't be triggered
      // we want to make it possible to extract entities without having any intents
      return { ...artefacts, contexts: [], intents: [], pattern_entities: input.pattern_entities } as Predictors
    }

    const { ctx_model, intent_model_by_ctx, oos_model } = artefacts
    const ctx_classifier = ctx_model ? new tools.mlToolkit.SVM.Predictor(ctx_model) : undefined
    const intent_classifier_per_ctx = _.toPairs(intent_model_by_ctx).reduce(
      (c, [ctx, intentModel]) => ({ ...c, [ctx]: new tools.mlToolkit.SVM.Predictor(intentModel as string) }),
      {} as _.Dictionary<MLToolkit.SVM.Predictor>
    )
    const oos_classifier = _.toPairs(oos_model).reduce(
      (c, [ctx, mod]) => ({ ...c, [ctx]: new tools.mlToolkit.SVM.Predictor(mod) }),
      {} as _.Dictionary<MLToolkit.SVM.Predictor>
    )
    const slot_tagger = new SlotTagger(tools.mlToolkit)
    slot_tagger.load(artefacts.slots_model)

    const kmeans = computeKmeans(output.intents, tools) // TODO load from artefacts when persisted

    return {
      ...artefacts,
      ctx_classifier,
      oos_classifier_per_ctx: oos_classifier,
      intent_classifier_per_ctx,
      slot_tagger,
      kmeans,
      pattern_entities: input.pattern_entities,
      intents: output.intents,
      contexts: input.contexts
    }
  }

  async predict(sentence: string, includedContexts: string[]): Promise<PredictOutput> {
    const input: PredictInput = {
      defaultLanguage: this.defaultLanguage,
      sentence,
      includedContexts
    }

    // error handled a level highr
    return Predict(input, Engine.tools, this.predictorsByLang)
  }

  private _mergeModels(previousModel: Model, trainingOuput: Model) {
    const { artefacts: previousArtefacts } = previousModel.data
    const { artefacts: currentArtefacts } = trainingOuput.data
    if (!previousArtefacts || !currentArtefacts) {
      return previousModel
    }

    const artefacts = _.merge({}, previousArtefacts, currentArtefacts)
    const mergedModel = _.merge({}, trainingOuput, { data: { artefacts } })

    // lodash merge messes up buffers objects
    mergedModel.data.artefacts.slots_model = new Buffer(mergedModel.data.artefacts.slots_model)
    return mergedModel
  }

  private _ctxHasChanged = (previousIntents: Intent<string>[], currentIntents: Intent<string>[]) => (ctx: string) => {
    const prevHash = this._computeCtxHash(previousIntents, ctx)
    const currHash = this._computeCtxHash(currentIntents, ctx)
    return prevHash !== currHash
  }

  private _computeCtxHash = (intents: Intent<string>[], ctx: string) => {
    const intentsOfCtx = intents.filter(i => i.contexts.includes(ctx))
    return crypto
      .createHash('md5')
      .update(JSON.stringify(intentsOfCtx))
      .digest('hex')
  }
}
