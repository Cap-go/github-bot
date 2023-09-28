import type { Handler, HandlerContext, HandlerEvent } from '@netlify/functions'
import { createLambdaFunction, createProbot } from '@probot/adapter-aws-lambda-serverless';
import * as appFn from '../../src/index'

const handler = createLambdaFunction(appFn.default, {
  probot: createProbot(),
})

export { handler }
