import { spawn } from 'child_process';
export class LogFilterService {
    async filterLogs(logs, jqFilter, startTime, endTime) {
        if (!jqFilter && !startTime && !endTime) {
            return logs;
        }
        // Build the complete JQ filter
        let filter = '.items[]';
        if (jqFilter) {
            filter += ` | ${jqFilter}`;
        }
        // Add time filtering if provided
        if (startTime || endTime) {
            let timeFilter = '';
            if (startTime && endTime) {
                timeFilter = `select(.start_time >= "${startTime}" and .end_time <= "${endTime}")`;
            }
            else if (startTime) {
                timeFilter = `select(.start_time >= "${startTime}")`;
            }
            else if (endTime) {
                timeFilter = `select(.end_time <= "${endTime}")`;
            }
            if (jqFilter) {
                filter += ` | ${timeFilter}`;
            }
            else {
                filter = `.items[] | ${timeFilter}`;
            }
        }
        return this.executeJqFilter(logs, filter);
    }
    buildDeniedStagedPoliciesFilter(namespace, sourceName, destName) {
        let filter = 'select(.policies.pending != null and (any(.policies.pending[]; .action == "Deny" and .trigger.kind == "StagedNetworkPolicy")))';
        if (namespace) {
            filter += ` | select(.source_namespace == "${namespace}" or .dest_namespace == "${namespace}")`;
        }
        if (sourceName) {
            filter += ` | select(.source_name | contains("${sourceName}"))`;
        }
        if (destName) {
            filter += ` | select(.dest_name | contains("${destName}"))`;
        }
        return filter;
    }
    buildPolicyViolationsFilter(action, namespace, protocol) {
        let filter = '.';
        if (action) {
            filter += ` | select(.action == "${action}")`;
        }
        if (namespace) {
            filter += ` | select(.source_namespace == "${namespace}" or .dest_namespace == "${namespace}")`;
        }
        if (protocol) {
            filter += ` | select(.protocol == "${protocol}")`;
        }
        return filter;
    }
    buildHighTrafficFilter(minPackets, minBytes) {
        return `select(.packets_in >= ${minPackets} or .packets_out >= ${minPackets} or .bytes_in >= ${minBytes} or .bytes_out >= ${minBytes})`;
    }
    buildNamespaceFilter(namespace) {
        return `select(.source_namespace == "${namespace}" or .dest_namespace == "${namespace}")`;
    }
    aggregateLogsForPolicyGeneration(logs, namespace) {
        // Filter logs for the specified namespace
        const namespaceLogs = logs.filter(log => log.source_namespace === namespace || log.dest_namespace === namespace);
        // Create a map to aggregate unique flows
        const aggregationMap = new Map();
        namespaceLogs.forEach(log => {
            const key = `${log.source_name}|${log.source_namespace}|${log.source_labels}|${log.dest_name}|${log.dest_namespace}|${log.dest_labels}|${log.protocol}|${log.dest_port}`;
            if (!aggregationMap.has(key)) {
                aggregationMap.set(key, {
                    source_name: log.source_name,
                    source_namespace: log.source_namespace,
                    source_labels: log.source_labels,
                    dest_name: log.dest_name,
                    dest_namespace: log.dest_namespace,
                    dest_labels: log.dest_labels,
                    protocol: log.protocol,
                    dest_port: log.dest_port,
                    flow_count: 0,
                    total_packets: 0,
                    total_bytes: 0,
                    actions: new Set()
                });
            }
            const aggregated = aggregationMap.get(key);
            aggregated.flow_count += 1;
            aggregated.total_packets += (log.packets_in || 0) + (log.packets_out || 0);
            aggregated.total_bytes += (log.bytes_in || 0) + (log.bytes_out || 0);
            aggregated.actions.add(log.action);
        });
        // Convert Map to array and convert Set to Array
        return Array.from(aggregationMap.values()).map(item => ({
            ...item,
            actions: Array.from(item.actions)
        }));
    }
    generateCalicoNetworkPolicies(aggregatedLogs, namespace, selectorKey) {
        const policies = [];
        // Group flows by source workload (based on selector key)
        const sourceGroups = new Map();
        aggregatedLogs.forEach(log => {
            if (log.source_namespace === namespace) {
                // Extract the selector value from source_labels
                const selectorValue = this.extractLabelValue(log.source_labels, selectorKey);
                if (selectorValue) {
                    const groupKey = `${selectorValue}`;
                    if (!sourceGroups.has(groupKey)) {
                        sourceGroups.set(groupKey, []);
                    }
                    sourceGroups.get(groupKey).push(log);
                }
            }
        });
        // Generate a policy for each source workload group
        sourceGroups.forEach((flows, selectorValue) => {
            const policyName = `allow-${selectorValue.toLowerCase().replace(/[^a-z0-9]/g, '-')}-egress`;
            // Group egress rules by destination
            const egressRules = [];
            const destinationGroups = new Map();
            flows.forEach(flow => {
                const destKey = `${flow.dest_namespace}|${flow.protocol}|${flow.dest_port}`;
                if (!destinationGroups.has(destKey)) {
                    destinationGroups.set(destKey, []);
                }
                destinationGroups.get(destKey).push(flow);
            });
            destinationGroups.forEach((destFlows, destKey) => {
                const [destNamespace, protocol, destPort] = destKey.split('|');
                const rule = {
                    action: "Allow",
                    destination: {},
                    protocol: protocol.toUpperCase()
                };
                if (destNamespace !== namespace) {
                    // External namespace
                    rule.destination.namespaceSelector = {
                        matchLabels: {
                            "kubernetes.io/metadata.name": destNamespace
                        }
                    };
                }
                else {
                    // Same namespace - try to extract selector from dest_labels
                    const destSelector = this.extractLabelValue(destFlows[0].dest_labels, selectorKey);
                    if (destSelector) {
                        rule.destination.selector = {
                            matchLabels: {
                                [selectorKey]: destSelector
                            }
                        };
                    }
                }
                if (destPort && destPort !== 'null' && destPort !== '0') {
                    rule.ports = [
                        {
                            protocol: protocol.toUpperCase(),
                            port: parseInt(destPort)
                        }
                    ];
                }
                egressRules.push(rule);
            });
            const policy = {
                apiVersion: "projectcalico.org/v3",
                kind: "NetworkPolicy",
                metadata: {
                    name: policyName,
                    namespace: namespace
                },
                spec: {
                    selector: {
                        matchLabels: {
                            [selectorKey]: selectorValue
                        }
                    },
                    types: ["Egress"],
                    egress: egressRules
                }
            };
            policies.push(policy);
        });
        return policies;
    }
    extractLabelValue(labels, key) {
        if (!labels)
            return null;
        // Parse labels like "app=frontend | version=v1 | env=prod"
        const labelPairs = labels.split('|').map(pair => pair.trim());
        for (const pair of labelPairs) {
            const [labelKey, labelValue] = pair.split('=').map(s => s.trim());
            if (labelKey === key && labelValue) {
                return labelValue;
            }
        }
        return null;
    }
    async executeJqFilter(logs, filter) {
        return new Promise((resolve, reject) => {
            const input = JSON.stringify({ items: logs });
            const process = spawn('jq', ['-c', filter]);
            let output = '';
            let errorOutput = '';
            process.stdout?.on('data', (data) => {
                output += data.toString();
            });
            process.stderr?.on('data', (data) => {
                errorOutput += data.toString();
            });
            process.on('close', (code) => {
                if (code === 0) {
                    try {
                        // Handle empty output (no matches found)
                        if (!output.trim()) {
                            resolve([]);
                            return;
                        }
                        // Parse the JQ output - it might be multiple JSON objects
                        const lines = output.trim().split('\n').filter(line => line.trim());
                        // Handle case where JQ returns null or empty results
                        if (lines.length === 0) {
                            resolve([]);
                            return;
                        }
                        const results = lines.map(line => {
                            // Skip null values that JQ might output
                            if (line === 'null') {
                                return null;
                            }
                            return JSON.parse(line);
                        }).filter(result => result !== null);
                        resolve(results);
                    }
                    catch (parseError) {
                        reject(new Error(`Failed to parse JQ output: ${parseError instanceof Error ? parseError.message : String(parseError)}. Output: "${output.trim()}"`));
                    }
                }
                else {
                    reject(new Error(`JQ filter failed: ${errorOutput}`));
                }
            });
            process.on('error', (error) => {
                reject(new Error(`Failed to execute JQ: ${error.message}`));
            });
            // Send input to JQ
            process.stdin?.write(input);
            process.stdin?.end();
        });
    }
    // Helper method to check if JQ is available
    async checkJqAvailable() {
        return new Promise((resolve) => {
            const process = spawn('jq', ['--version']);
            process.on('close', (code) => {
                resolve(code === 0);
            });
            process.on('error', () => {
                resolve(false);
            });
        });
    }
}
//# sourceMappingURL=log-filter.js.map