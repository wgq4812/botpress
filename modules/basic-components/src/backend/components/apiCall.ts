import * as sdk from 'botpress/sdk'
import { uniqueId } from 'lodash'
import { prettyId } from './utils'

const generateFlow = async (): Promise<any> => {
  // Return normal flow and skill flow. I need to do this. Because skills need to be created
  return {
    transitions: createTransitions(),
    flow: {
      nodes: createNodes(),
      catchAll: {
        onReceive: [],
        next: []
      }
    },
    skills: skillsFlow()
  }
}

const createNodes = () => {
  const nodes: any[] = [
    {
      id: prettyId(),
      name: 'entry',
      next: [
        {
          condition: 'true',
          node: 'call_from_previous_answer'
        }
      ],
      onEnter: <any>[
        {
          contentType: 'builtin_text',
          FormData: {
            text$en: "Ask Question - What's your favorite ice cream Flavor ?",
            markdown$en: true,
            typing$en: true
          }
        }
      ],
      onReceive: ['builtin/setVariable {"type":"temp","name":"flavor","value":"{{event.payload.text}}"}']
    },
    {
      id: prettyId(),
      name: 'show_output',
      next: [
        {
          condition: 'true',
          node: 'END'
        }
      ],
      onEnter: <any>[
        {
          contentType: 'builtin_text',
          formData: { text$en: 'Hello hello', markdown$en: true, typing$en: true }
        }
      ],
      onReceive: null,
      type: 'standard'
    },
    {
      id: 'skill-d73632',
      type: 'skill-call',
      skill: 'CallAPI',
      name: 'call_from_previous_answer',
      flow: 'skills/call_from_previous_answer.flow.json',
      next: [
        {
          caption: 'On success',
          condition: 'temp.valid_yqw4b030nu',
          node: 'show_output'
        },
        {
          caption: 'On failure',
          condition: '!temp.valid_yqw4b030nu',
          node: 'retry'
        }
      ],
      onEnter: null,
      onReceive: null
    },
    {
      id: 'skill-294337',
      type: 'skill-call',
      skill: 'choice',
      name: 'retry',
      flow: 'skills/show_output_api.flow.json',
      next: [
        {
          caption: 'User picked [yes]',
          condition: 'temp[\'skill-choice-ret-32yypzxouo\'] == "yes"',
          node: 'entry'
        },
        {
          caption: 'User picked [no]',
          condition: 'temp[\'skill-choice-ret-32yypzxouo\'] == "no"',
          conditionType: 'raw',
          node: 'END'
        },
        {
          caption: 'On failure',
          condition: 'true',
          conditionType: 'always',
          node: 'END'
        }
      ],
      onEnter: null,
      onReceive: null
    }
  ]
  return nodes
}

const createTransitions = (): sdk.NodeTransition[] => {
  const keySuffix = uniqueId()

  return [
    { caption: 'On success', condition: `temp.valid${keySuffix}`, node: '' },
    { caption: 'On failure', condition: `!temp.valid${keySuffix}`, node: '' }
  ]
}

const skillsFlow = () => {
  const flow: any[] = [
    {
      skill: 'CallAPI',
      name: 'call_from_previous_answer',
      startNode: 'call_from_previous_answer',
      flow: 'call_from_previous_answer.flow.json',
      location: 'skills/call_from_previous_answer.flow.json',
      skillData: {
        randomId: prettyId(),
        method: 'post',
        memory: 'temp',
        // @ts-ignore
        body: '{"value": "{{temp.flavor}}"}',
        url: 'http://localhost:8080',
        variable: 'response',
        invalidJson: false
      }
    },
    {
      skill: 'choice',
      name: 'show_output_api',
      startNode: 'show_output_api',
      flow: 'show_output_api.flow.json',
      location: 'skills/show_output_api.flow.json',
      skillData: {
        randomId: prettyId(),
        invalidContentId: '',
        keywords: {
          yes: ['yes', 'Yes'],
          no: ['no', 'No']
        },
        config: {
          nbMaxRetries: 3,
          repeatChoicesOnInvalid: false,
          variableName: ''
        }
      }
    }
  ]
  return flow
}
export default { generateFlow }
