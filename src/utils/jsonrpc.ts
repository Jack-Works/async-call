const jsonrpc = '2.0'
type ID = string | number | null | undefined

type JSONRPC = Readonly<{
    jsonrpc: typeof jsonrpc
    id: ID
}>
export type Request = Readonly<{
    method: string
    params: readonly unknown[] | object
}> & { remoteStack?: string } & JSONRPC
export function Request(id: ID, method: string, params: readonly unknown[] | object, remoteStack: string): Request {
    const x: Request = { jsonrpc, id, method, params, remoteStack }
    if (remoteStack.length === 0) delete x.remoteStack
    return x
}

export type SuccessResponse = Readonly<{ result: unknown }> & { resultIsUndefined?: boolean } & JSONRPC
export function SuccessResponse(id: ID, result: any, noUndefinedKeeping: boolean): SuccessResponse {
    const x: SuccessResponse = { jsonrpc, id, result: result === undefined ? null : result }
    if (!noUndefinedKeeping && result === undefined) {
        x.resultIsUndefined = true
    }
    return x
}

export type ErrorResponse = JSONRPC &
    Readonly<{
        error: { code: number; message: string; data?: { stack?: string; type?: string } }
    }>

export function ErrorResponse(
    id: ID,
    code: number,
    message: string,
    stack: string,
    type: string = 'Error',
): ErrorResponse {
    if (id === undefined) id = null
    code = Math.floor(code)
    const error: ErrorResponse['error'] = { code, message, data: { stack, type } }
    return { error, id, jsonrpc }
}

// Pre defined error in section 5.1
ErrorResponse.ParseError = (stack = '') => ErrorResponse(null, -32700, 'Parse error', stack)
ErrorResponse.InvalidRequest = (id: ID) => ErrorResponse(id, -32600, 'Invalid Request', '')
ErrorResponse.MethodNotFound = (id: ID) => ErrorResponse(id, -32601, 'Method not found', '')
ErrorResponse.InvalidParams = (id: ID) => ErrorResponse(id, -32602, 'Invalid params', '')
ErrorResponse.InternalError = (id: ID, message: string = '') =>
    ErrorResponse(id, -32603, 'Internal error' + message, '')

export type Response = SuccessResponse | ErrorResponse

export function isJSONRPCObject(data: any): data is Response | Request {
    if (!isObject(data)) return false
    if (!hasKey(data, 'jsonrpc')) return false
    if (data.jsonrpc !== jsonrpc) return false
    if (hasKey(data, 'params')) {
        const params = (data as Request).params
        if (!Array.isArray(params) && !isObject(params)) return false
    }
    return true
}

export function isObject(params: any): params is object {
    return typeof params === 'object' && params !== null
}

export function hasKey<T, Q extends string>(
    obj: T,
    key: Q,
): obj is T &
    {
        [key in Q]: unknown
    } {
    return key in obj
}