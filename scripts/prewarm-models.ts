import { env, pipeline } from '@huggingface/transformers'
import {
  configureTransformersEnvironment,
  SEMANTIC_MODEL_DTYPE,
  SEMANTIC_MODEL_ID,
  SEMANTIC_MODEL_REVISION,
  SENTIMENT_MODEL_DTYPE,
  SENTIMENT_MODEL_ID,
  SENTIMENT_MODEL_REVISION,
} from '../server/semanticAnalysis'

configureTransformersEnvironment(env)
await pipeline('feature-extraction', SEMANTIC_MODEL_ID, { dtype: SEMANTIC_MODEL_DTYPE, revision: SEMANTIC_MODEL_REVISION })
await pipeline('sentiment-analysis', SENTIMENT_MODEL_ID, { dtype: SENTIMENT_MODEL_DTYPE, revision: SENTIMENT_MODEL_REVISION })
console.log('Pinned Garaxe semantic models are available in the configured cache.')
