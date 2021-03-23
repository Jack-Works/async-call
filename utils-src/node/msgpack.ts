import type { encode as S, decode as D } from '@msgpack/msgpack'
import type { Serialization } from 'async-call-rpc'
export const Msgpack_Serialization = (
    {
        encode,
        decode,
    }: {
        encode: typeof S
        decode: typeof D
    } = require('@msgpack/msgpack'),
): Serialization => ({
    deserialization(data: Uint8Array) {
        return decode(data)
    },
    serialization(data: any) {
        return encode(data)
    },
})
