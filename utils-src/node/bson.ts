import type { serialize as S, deserialize as D } from 'bson'
import type { Serialization } from 'async-call-rpc'

export const BSON_Serialization = (
    {
        deserialize,
        serialize,
    }: {
        serialize: typeof S
        deserialize: typeof D
    } = require('bson'),
): Serialization => ({
    deserialization(data: Buffer) {
        return deserialize(data)
    },
    serialization(data: any) {
        return serialize(data)
    },
})
