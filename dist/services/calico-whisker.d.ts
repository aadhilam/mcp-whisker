export interface FlowLog {
    start_time: string;
    end_time: string;
    action: string;
    source_name: string;
    source_namespace: string;
    source_labels: string;
    dest_name: string;
    dest_namespace: string;
    dest_labels: string;
    protocol: string;
    dest_port: number;
    reporter: string;
    policies: {
        enforced: Policy[];
        pending: Policy[];
    };
    packets_in: number;
    packets_out: number;
    bytes_in: number;
    bytes_out: number;
}
export interface Policy {
    kind: string;
    name: string;
    namespace: string;
    tier: string;
    action: string;
    policy_index: number;
    rule_index: number;
    trigger: Policy | null;
}
export interface FlowLogsResponse {
    items: FlowLog[];
}
export declare class CalicoWhiskerService {
    private portForwardProcess;
    private readonly WHISKER_URL;
    private readonly WHISKER_ENDPOINT;
    private kubeconfigPath;
    setupPortForward(kubeconfigPath?: string): Promise<void>;
    getFlowLogs(): Promise<FlowLog[]>;
    getNamespaceFlowSummary(namespace: string): Promise<string>;
    stopPortForward(): Promise<void>;
    isPortForwardRunning(): boolean;
    private killExistingPortForwards;
    checkWhiskerServiceStatus(): Promise<{
        available: boolean;
        details: string;
    }>;
    analyzeBlockedFlows(namespace?: string): Promise<string>;
    private retrievePolicyDetails;
}
//# sourceMappingURL=calico-whisker.d.ts.map