import { AsyncCallBatch, AsyncCallNotify } from '../utils/internalSymbol'
import { Request } from '../utils/jsonrpc'
/**
 * Wrap the AsyncCall instance to use batch call.
 * @param asyncCallInstance
 * @example
 * const [batched, send, drop] = batch(AsyncCall(...))
 */
export function batch<T extends object>(asyncCallInstance: T): [T, () => void, (error?: unknown) => void] {
    // let pending = new Promise((resolve, reject) => {})
    let queue: BatchQueue = [] as any
    return [
        new Proxy(asyncCallInstance, {
            get(target: any, p) {
                const f = (...args: any) => target[AsyncCallBatch](queue, p, ...args)
                // @ts-ignore
                f[AsyncCallNotify] = (...args: any) => target[AsyncCallBatch][AsyncCallNotify](queue, p, ...args)
                // @ts-ignore
                f[AsyncCallNotify][AsyncCallNotify] = f[AsyncCallNotify]
                return f
            },
        }),
        () => queue.r?.[0](),
        (error = new Error('Aborted')) => {
            queue.r?.[1](error)
            queue = []
        },
    ]
}
export type BatchQueue = Request[] & { r?: [() => void, (error?: unknown) => void] }