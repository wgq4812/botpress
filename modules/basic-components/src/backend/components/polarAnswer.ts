import * as sdk from 'botpress/sdk'
import { uniqueId } from 'lodash'
import { prettyId } from './utils'

const generateFlow = async (): Promise<any> => {
  return {
    transitions: createTransitions(),
    flow: {
      nodes: createNodes(),
      catchAll: {
        next: []
      }
    },
    skills: skillsFlow()
  }
}

const createNodes = () => {
  // cat main.flow.json | jq '.nodes | .[] | select(has("skill") | not)'
  const nodes: any[] = [
    {
      id: prettyId(),
      name: 'yes-answer',
      next: [
        {
          condition: 'true',
          node: ''
        }
      ],

      onEnter: <any>[
        {
          contentType: 'builtin_text',
          formData: { text$en: 'Yes answer', markdown$en: true, typing$en: true }
        }
      ],
      onReceive: null,
      type: 'standard'
    },
    {
      id: prettyId(),
      name: 'no-answer',
      next: [
        {
          condition: 'true',
          node: ''
        }
      ],
      onEnter: <any>[
        {
          contentType: 'builtin_text',
          formData: { text$en: 'No answer', markdown$en: true, typing$en: true }
        }
      ],
      onReceive: null,
      type: 'standard'
    },
    {
      id: prettyId(),
      name: 'didnt-understand',
      next: [
        {
          condition: 'true',
          node: 'choice-fe0bb7'
        }
      ],
      onEnter: null,
      onReceive: null,
      type: 'standard'
    },
    {
      id: 'skill-fe0bb7',
      type: 'skill-call',
      skill: 'choice',
      name: 'choice-yes',
      flow: 'skills/show_output.flow.json',
      next: [
        {
          caption: 'User picked [yes]',
          condition: 'temp[\'skill-choice-ret-9dwdumw4fd\'] == "yes"',
          node: 'yes-answer'
        },
        {
          caption: 'User picked [no]',
          condition: 'temp[\'skill-choice-ret-9dwdumw4fd\'] == "no"',
          node: 'no-answer'
        },
        {
          caption: 'On failure',
          condition: 'true',
          node: 'didnt-understand'
        }
      ],
      onEnter: null,
      onReceive: null
    }
  ]
  return nodes
}
const skillsFlow = () => {
  const flow: any[] = [
    {
      startNode: 'entry',
      skill: 'choice',
      flow: 'show_output.flow.json',
      name: 'show_output',
      location: 'skills/show_output.flow.json',
      skillData: {
        randomId: 'show_output',
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

const createTransitions = (): sdk.NodeTransition[] => {
  const keySuffix = uniqueId()

  return [
    { caption: 'On success', condition: `temp.valid${keySuffix}`, node: '' },
    { caption: 'On failure', condition: `!temp.valid${keySuffix}`, node: '' }
  ]
}

export default { generateFlow }
