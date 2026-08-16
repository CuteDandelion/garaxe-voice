import { describe, expect, it } from 'vitest'
import { Tensor as TransformersTensor } from '@huggingface/transformers'
import { Tensor as OnnxTensor } from 'onnxruntime-node'
import sharp from 'sharp'

describe('Transformers and ONNX native dependency compatibility', () => {
  it('loads Transformers, ONNX Runtime, and Sharp in one process', async () => {
    const values = new Float32Array([1, 2, 3, 4])
    const transformersTensor = new TransformersTensor('float32', values, [1, 4])
    const onnxTensor = new OnnxTensor('float32', values, [1, 4])

    expect(transformersTensor.tolist()).toEqual([[1, 2, 3, 4]])
    expect(Array.from(onnxTensor.data)).toEqual([1, 2, 3, 4])

    const image = await sharp({
      create: {
        width: 1,
        height: 1,
        channels: 4,
        background: { r: 245, g: 151, b: 77, alpha: 1 },
      },
    }).png().toBuffer()
    const metadata = await sharp(image).metadata()

    expect(metadata).toMatchObject({ format: 'png', width: 1, height: 1, channels: 4 })
  })
})
