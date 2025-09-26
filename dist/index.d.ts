#!/usr/bin/env node
export declare class CalicoWhiskerMCPServer {
    private server;
    private calicoService;
    private k8sService;
    private logFilterService;
    constructor();
    private setupToolHandlers;
    private handleConnectToCluster;
    private handleGetFlowLogs;
    private handleGetDeniedStagedPolicies;
    private handleGetPolicyViolations;
    private handleGetHighTrafficFlows;
    private handleGetNamespaceFlows;
    private handleGenerateNetworkPolicies;
    private handleGetKubeconfigContexts;
    private handleGetCurrentContext;
    private handleCheckKubeconfig;
    private handleDiagnoseConnection;
    private handleGetNamespaceFlowSummary;
    private handleAnalyzeBlockedFlows;
    run(): Promise<void>;
}
//# sourceMappingURL=index.d.ts.map