import { FlowLog } from './calico-whisker.js';
export declare class LogFilterService {
    filterLogs(logs: FlowLog[], jqFilter?: string, startTime?: string, endTime?: string): Promise<FlowLog[]>;
    buildDeniedStagedPoliciesFilter(namespace?: string, sourceName?: string, destName?: string): string;
    buildPolicyViolationsFilter(action?: string, namespace?: string, protocol?: string): string;
    buildHighTrafficFilter(minPackets: number, minBytes: number): string;
    buildNamespaceFilter(namespace: string): string;
    aggregateLogsForPolicyGeneration(logs: FlowLog[], namespace: string): any[];
    generateCalicoNetworkPolicies(aggregatedLogs: any[], namespace: string, selectorKey: string): any[];
    private extractLabelValue;
    private executeJqFilter;
    checkJqAvailable(): Promise<boolean>;
}
//# sourceMappingURL=log-filter.d.ts.map