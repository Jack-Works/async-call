/**
 * See the document at https://github.com/Jack-Works/async-call/
 */
import { AsyncCallOptions, AsyncCall } from './Async-Call'
import { AsyncCallIgnoreResponse } from './utils/internalSymbol'
import { normalizeStrictOptions } from './utils/normalizeOptions'
import { generateRandomID } from './utils/generateRandomID'
import { isFunction, isString, Object_setPrototypeOf, Promise_resolve } from './utils/constants'
import {
    Err_Cannot_find_a_running_iterator_with_given_ID,
    Err_Only_string_can_be_the_RPC_method_name,
    makeHostedMessage,
} from './utils/error'

const i = 'rpc.async-iterator.'
// ! side effect
const AsyncIteratorStart = Symbol.for(i + 'start')
const AsyncIteratorNext = Symbol.for(i + 'next')
const AsyncIteratorReturn = Symbol.for(i + 'return')
const AsyncIteratorThrow = Symbol.for(i + 'throw')

interface AsyncGeneratorInternalMethods {
    [AsyncIteratorStart](method: string, params: unknown[]): Promise<string>
    [AsyncIteratorNext](id: string, value: unknown): Promise<IteratorResult<unknown>>
    [AsyncIteratorReturn](id: string, value: unknown): Promise<IteratorResult<unknown>>
    [AsyncIteratorThrow](id: string, value: unknown): Promise<IteratorResult<unknown>>
}

/** @internal */
export type _IteratorOrIterableFunction = (
    ...args: any
) => Iterator<any, any, any> | Iterable<any> | AsyncIterator<any, any, any> | AsyncIterable<any>
/** @internal */
export type _IteratorLikeToAsyncGenerator<T extends _IteratorOrIterableFunction> = T extends (
    ...args: any
) => AsyncGenerator<any>
    ? T // return async generator as-is so generics can be preserved
    : T extends (
          ...args: infer Args
      ) =>
          | Iterator<infer Yield, infer Return, infer Next>
          | Iterable<infer Yield>
          | AsyncIterator<infer Yield, infer Return, infer Next>
          | AsyncIterable<infer Yield>
    ? (...args: Args) => AsyncGenerator<Yield, Return, Next>
    : never

/**
 * Make all generator in the type T becomes AsyncGenerator
 *
 * @remarks
 * Only generics signatures on function that returning an AsyncGenerator<T> will be preserved due to the limitation of TypeScript.
 *
 * Method called `then` are intentionally removed because it is very likely to be a foot gun in promise auto-unwrap.
 * @internal
 */
export type _AsyncGeneratorVersionOf<T> = {
    // Omit 'then'
    [key in keyof T as key extends 'then'
        ? never
        : // Omit non-iterator/iterable
        T[key] extends _IteratorOrIterableFunction
        ? key
        : never]: T[key] extends _IteratorOrIterableFunction ? _IteratorLikeToAsyncGenerator<T[key]> : never
}

type Iter = Iterator<unknown, unknown, unknown> | AsyncIterator<unknown>
type IterResult = IteratorResult<unknown> | Promise<IteratorResult<unknown>>
/**
 * The async generator version of the AsyncCall
 * @param thisSideImplementation - The implementation when this AsyncCall acts as a JSON RPC server.
 * @param options - {@link AsyncCallOptions}
 * @typeParam OtherSideImplementedFunctions - The type of the API that server expose. For any function on this interface, AsyncCall will convert it to the Promised type.
 * @remarks
 * Warning: Due to technical limitation, AsyncGeneratorCall will leak memory. Use it at your own risk.
 *
 * To use AsyncGeneratorCall, the server and the client MUST support the following JSON RPC internal methods which is pre ECMAScript async generator semantics:
 *
 * - `rpc.async-iterator.start`
 *
 * - `rpc.async-iterator.next`
 *
 * - `rpc.async-iterator.return`
 *
 * - `rpc.async-iterator.throw`
 *
 * @example
 * ```ts
 * const server = {
 *      async *generator() {
 *          let last = 0
 *          while (true) yield last++
 *      },
 * }
 * type Server = typeof server
 * const serverRPC = AsyncGeneratorCall<Server>({}, { channel })
 * async function main() {
 *      for await (const x of serverRPC.generator()) {
 *          console.log('Server yielded number', x)
 *      }
 * }
 * ```
 * @public
 */
export function AsyncGeneratorCall<OtherSideImplementedFunctions = {}>(
    thisSideImplementation: null | undefined | object | Promise<object>,
    options: AsyncCallOptions,
): _AsyncGeneratorVersionOf<OtherSideImplementedFunctions> {
    const iterators = new Map<string | number, Iter>()
    const [methodNotFound] = normalizeStrictOptions(options.strict ?? true)
    const { idGenerator = generateRandomID } = options
    const findIterator = (
        id: string,
        next: (iterator: Iter) => IterResult | undefined | false,
    ): false | undefined | IterResult | typeof AsyncCallIgnoreResponse => {
        const it = iterators.get(id)
        if (!it) {
            if (methodNotFound)
                throw makeHostedMessage(Err_Cannot_find_a_running_iterator_with_given_ID, new Error(`Iterator ${id}, `))
            else return AsyncCallIgnoreResponse
        }
        const result = next(it)
        isFinished(result, () => iterators.delete(id))
        return result
    }
    const server = {
        async [AsyncIteratorStart](method, args) {
            const iteratorGenerator: unknown = ((await thisSideImplementation) as any)[method]
            if (!isFunction(iteratorGenerator)) {
                if (methodNotFound) throw new TypeError(method + ' is not a function')
                else return AsyncCallIgnoreResponse
            }
            const iterator = iteratorGenerator(...args)
            const id = idGenerator()
            iterators.set(id, iterator)
            return Promise_resolve(id)
        },
        [AsyncIteratorNext](id, val) {
            return findIterator(id, (it) => it.next(val as any))
        },
        [AsyncIteratorReturn](id, val) {
            return findIterator(id, (it) => isFunction(it.return) && it.return(val))
        },
        [AsyncIteratorThrow](id, val) {
            return findIterator(id, (it) => isFunction(it.throw) && it.throw(val))
        },
    } as AsyncGeneratorInternalMethods
    const remote = AsyncCall<AsyncGeneratorInternalMethods>(server, options)
    const proxyTrap = (cache: any, key: string): ((...args: unknown[]) => AsyncIterableIterator<unknown>) => {
        if (!isString(key))
            throw makeHostedMessage(Err_Only_string_can_be_the_RPC_method_name, new TypeError(''))
        if (cache[key]) return cache[key]
        const f = (...args: unknown[]) => {
            const id = remote[AsyncIteratorStart](key, args)
            return new _AsyncGenerator(remote, id)
        }
        Object.defineProperty(cache, key, { value: f, configurable: true })
        return f
    }
    return new Proxy({ __proto__: null }, { get: proxyTrap }) as _AsyncGeneratorVersionOf<OtherSideImplementedFunctions>
}
class _AsyncGenerator implements AsyncIterableIterator<unknown>, AsyncIterator<unknown, unknown, unknown> {
    /** done? */
    private d: boolean = false
    /** check */
    private c = async (val: IterResult) => {
        await isFinished(val, () => (this.d = true))
        return val
    }
    /**
     * @param r Remote Implementation
     * @param i id
     */
    constructor(private r: AsyncGeneratorInternalMethods, private i: Promise<string>) {}
    async return(val: unknown) {
        if (this.d) return makeIteratorResult(true, val)
        return this.c(this.r[AsyncIteratorReturn](await this.i, val))
    }
    async next(val?: unknown) {
        if (this.d) return makeIteratorResult(true)
        return this.c(this.r[AsyncIteratorNext](await this.i, val))
    }
    async throw(val?: unknown) {
        if (!this.d) return this.c(this.r[AsyncIteratorThrow](await this.i, val))
        throw val
    }
    // Inherited from AsyncGeneratorPrototype
    declare [Symbol.asyncIterator]: () => this
}
// ! side effect
const EmptyAsyncGenerator = async function* () {}
const AsyncGeneratorConstructor = EmptyAsyncGenerator.constructor
const AsyncGeneratorConstructorPrototype = AsyncGeneratorConstructor.prototype
Object_setPrototypeOf(_AsyncGenerator, AsyncGeneratorConstructorPrototype)
const AsyncGeneratorPrototype = Object.getPrototypeOf(EmptyAsyncGenerator())
Object_setPrototypeOf(_AsyncGenerator.prototype, AsyncGeneratorPrototype)

const isFinished = async (result: IterResult | undefined | false, cb: () => void) => {
    try {
        const x = await result
        x && x.done && cb()
    } catch {}
}

const makeIteratorResult = (done: boolean, value: unknown = undefined): IteratorResult<unknown, unknown> => ({
    done,
    value,
})
