export declare function startMcpServer(): Promise<void>;
export declare function checkBeforeApplyLocal(args: {
    sql: string;
    pgVersion?: string;
    statsPath?: string;
    policyPath?: string;
}): import("@nock/core").VerdictV1;
