import { spawn } from 'child_process';
import axios from 'axios';
export class CalicoWhiskerService {
    portForwardProcess = null;
    WHISKER_URL = 'http://127.0.0.1:8081';
    WHISKER_ENDPOINT = '/whisker-backend/flows';
    kubeconfigPath = null;
    async setupPortForward(kubeconfigPath) {
        if (this.portForwardProcess) {
            console.error('Port-forward already running');
            return;
        }
        // Store kubeconfig path for future use
        if (kubeconfigPath) {
            this.kubeconfigPath = kubeconfigPath;
        }
        // Pre-flight checks
        console.error('🔍 Pre-flight checks for port-forward...');
        // Check if kubectl is accessible
        try {
            const testArgs = ['version', '--client'];
            if (this.kubeconfigPath) {
                testArgs.unshift('--kubeconfig', this.kubeconfigPath);
            }
            await new Promise((resolve, reject) => {
                const testProcess = spawn('kubectl', testArgs);
                testProcess.on('close', (code) => {
                    if (code === 0) {
                        console.error('✅ kubectl is accessible');
                        resolve();
                    }
                    else {
                        reject(new Error(`kubectl not accessible (exit code: ${code})`));
                    }
                });
                testProcess.on('error', (error) => {
                    reject(new Error(`kubectl command failed: ${error.message}`));
                });
            });
        }
        catch (error) {
            throw new Error(`Pre-flight check failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        // Check if port 8081 is already in use and kill existing processes
        await this.killExistingPortForwards();
        return new Promise((resolve, reject) => {
            const args = [
                'port-forward',
                'service/whisker',
                '8081:8081',
                '-n',
                'calico-system'
            ];
            // Add kubeconfig parameter if specified
            if (this.kubeconfigPath) {
                args.unshift('--kubeconfig', this.kubeconfigPath);
            }
            console.error('Starting port-forward with command:', 'kubectl', args.join(' '));
            this.portForwardProcess = spawn('kubectl', args);
            let errorOutput = '';
            let resolved = false;
            this.portForwardProcess.stdout?.on('data', (data) => {
                const output = data.toString();
                console.error(`Port-forward stdout: ${output.trim()}`);
            });
            this.portForwardProcess.stderr?.on('data', (data) => {
                const output = data.toString();
                console.error(`Port-forward stderr: ${output.trim()}`);
                errorOutput += output;
                if (output.includes('Forwarding from')) {
                    console.error('Port-forward established successfully');
                    if (!resolved) {
                        resolved = true;
                        resolve();
                    }
                }
                else if (output.includes('error') || output.includes('Error') || output.includes('failed')) {
                    // Log potential error indicators
                    console.error('⚠️  Potential error in port-forward stderr:', output.trim());
                }
            });
            this.portForwardProcess.on('error', (error) => {
                console.error('Port-forward spawn error:', error);
                this.portForwardProcess = null;
                if (!resolved) {
                    reject(new Error(`Failed to start port-forward: ${error.message}`));
                }
            });
            this.portForwardProcess.on('close', (code) => {
                console.error(`Port-forward process exited with code ${code}`);
                this.portForwardProcess = null;
                if (!resolved) {
                    let errorMessage = `Port-forward process exited with code ${code}`;
                    if (errorOutput) {
                        errorMessage += `\nError output: ${errorOutput.trim()}`;
                    }
                    // Add specific troubleshooting based on exit code
                    if (code === 1) {
                        errorMessage += '\n\nTroubleshooting for exit code 1:';
                        errorMessage += '\n- Check if the whisker service exists: kubectl get service whisker -n calico-system';
                        errorMessage += '\n- Verify you have permissions to access calico-system namespace';
                        errorMessage += '\n- Ensure your kubeconfig context is correct';
                        errorMessage += '\n- Check if the service is ready: kubectl get pods -n calico-system -l app.kubernetes.io/name=whisker';
                    }
                    errorMessage += '\nThis may indicate a Kubernetes connection issue or missing service.';
                    reject(new Error(errorMessage));
                }
            });
            // Wait a bit longer for the port-forward to establish with more detailed logging
            setTimeout(() => {
                if (this.portForwardProcess && this.portForwardProcess.pid && !resolved) {
                    console.error('Port-forward timeout - assuming success');
                    resolved = true;
                    resolve();
                }
                else if (!resolved) {
                    reject(new Error('Port-forward failed to establish within timeout period (5 seconds)'));
                }
            }, 5000); // Increased timeout to 5 seconds
        });
    }
    async getFlowLogs() {
        try {
            const response = await axios.get(`${this.WHISKER_URL}${this.WHISKER_ENDPOINT}`, {
                timeout: 10000,
            });
            return response.data.items || [];
        }
        catch (error) {
            if (axios.isAxiosError(error)) {
                if (error.code === 'ECONNREFUSED') {
                    throw new Error('Cannot connect to Calico Whisker. Please ensure port-forward is running.');
                }
                throw new Error(`Failed to fetch flow logs: ${error.message}`);
            }
            throw error;
        }
    }
    async getNamespaceFlowSummary(namespace) {
        try {
            // Get all flow logs
            const allLogs = await this.getFlowLogs();
            // Filter logs for the specified namespace (either source or destination)
            const namespaceLogs = allLogs.filter(log => log.source_namespace === namespace || log.dest_namespace === namespace);
            if (namespaceLogs.length === 0) {
                return JSON.stringify({
                    namespace,
                    error: `No flow logs found for namespace: ${namespace}`,
                    totalFlows: 0,
                    totalLogEntries: 0,
                    flows: []
                }, null, 2);
            }
            // Create aggregation map to combine flows from source and destination perspectives
            const flowMap = new Map();
            // Process each log and aggregate by flow
            namespaceLogs.forEach(log => {
                // Create a unique key for each flow INCLUDING action to separate Allow/Deny flows
                const flowKey = [
                    log.source_name,
                    log.source_namespace,
                    log.dest_name,
                    log.dest_namespace,
                    log.protocol,
                    log.dest_port,
                    log.action // Include action in the key so Allow/Deny flows are separate
                ].join('|');
                if (flowMap.has(flowKey)) {
                    // Aggregate existing flow
                    const existing = flowMap.get(flowKey);
                    existing.packetsIn += log.packets_in;
                    existing.packetsOut += log.packets_out;
                    existing.bytesIn += log.bytes_in;
                    existing.bytesOut += log.bytes_out;
                    // Update time range
                    if (log.start_time < existing.startTime) {
                        existing.startTime = log.start_time;
                    }
                    if (log.end_time > existing.endTime) {
                        existing.endTime = log.end_time;
                    }
                    // Aggregate policies
                    if (log.policies?.enforced) {
                        log.policies.enforced.forEach(policy => {
                            existing.enforcedPolicies.push(policy);
                            const policyName = `${policy.name} (${policy.namespace})`;
                            if (log.reporter === 'Src') {
                                existing.sourcePolicies.add(policyName);
                            }
                            else if (log.reporter === 'Dst') {
                                existing.destPolicies.add(policyName);
                            }
                        });
                    }
                    // Update actions based on reporter - preserve both Allow and Deny
                    if (log.reporter === 'Src') {
                        // If we already have a source action and this one is different, show both
                        if (existing.sourceAction !== 'N/A' && existing.sourceAction !== log.action) {
                            existing.sourceAction = `${existing.sourceAction}+${log.action}`;
                        }
                        else {
                            existing.sourceAction = log.action;
                        }
                    }
                    else if (log.reporter === 'Dst') {
                        // If we already have a dest action and this one is different, show both
                        if (existing.destAction !== 'N/A' && existing.destAction !== log.action) {
                            existing.destAction = `${existing.destAction}+${log.action}`;
                        }
                        else {
                            existing.destAction = log.action;
                        }
                    }
                }
                else {
                    // Create new flow entry
                    const sourcePolicies = new Set();
                    const destPolicies = new Set();
                    const enforcedPolicies = [];
                    // Extract enforced policies and categorize by reporter
                    if (log.policies?.enforced) {
                        log.policies.enforced.forEach(policy => {
                            enforcedPolicies.push(policy);
                            const policyName = `${policy.name} (${policy.namespace})`;
                            if (log.reporter === 'Src') {
                                sourcePolicies.add(policyName);
                            }
                            else if (log.reporter === 'Dst') {
                                destPolicies.add(policyName);
                            }
                        });
                    }
                    flowMap.set(flowKey, {
                        source: log.source_name,
                        sourceNamespace: log.source_namespace,
                        destination: log.dest_name,
                        destNamespace: log.dest_namespace,
                        protocol: log.protocol,
                        port: log.dest_port,
                        sourceAction: log.reporter === 'Src' ? log.action : 'N/A',
                        destAction: log.reporter === 'Dst' ? log.action : 'N/A',
                        packetsIn: log.packets_in,
                        packetsOut: log.packets_out,
                        bytesIn: log.bytes_in,
                        bytesOut: log.bytes_out,
                        startTime: log.start_time,
                        endTime: log.end_time,
                        sourcePolicies,
                        destPolicies,
                        enforcedPolicies
                    });
                }
            });
            // Helper function to add emojis to actions for better visibility
            const formatAction = (action) => {
                if (action === 'Allow')
                    return '✅ Allow';
                if (action === 'Deny')
                    return '🚨 Deny';
                if (action === 'N/A')
                    return '❌ N/A';
                return action;
            };
            // Convert to JSON format
            const flows = Array.from(flowMap.values())
                .sort((a, b) => a.startTime.localeCompare(b.startTime))
                .map(flow => ({
                source: {
                    name: flow.source,
                    namespace: flow.sourceNamespace,
                    action: formatAction(flow.sourceAction),
                    policies: Array.from(flow.sourcePolicies).sort()
                },
                destination: {
                    name: flow.destination,
                    namespace: flow.destNamespace,
                    action: formatAction(flow.destAction),
                    policies: Array.from(flow.destPolicies).sort()
                },
                connection: {
                    protocol: flow.protocol,
                    port: flow.port
                },
                enforcement: {
                    totalPolicies: flow.enforcedPolicies.length,
                    uniquePolicies: [...new Set(flow.enforcedPolicies.map(p => `${p.name} (${p.namespace})`))].sort(),
                    policyDetails: flow.enforcedPolicies.map(policy => ({
                        name: policy.name,
                        namespace: policy.namespace,
                        kind: policy.kind,
                        tier: policy.tier,
                        action: policy.action,
                        policyIndex: policy.policy_index,
                        ruleIndex: policy.rule_index
                    }))
                },
                traffic: {
                    packets: {
                        in: flow.packetsIn,
                        out: flow.packetsOut,
                        total: flow.packetsIn + flow.packetsOut
                    },
                    bytes: {
                        in: flow.bytesIn,
                        out: flow.bytesOut,
                        total: flow.bytesIn + flow.bytesOut
                    }
                },
                timeRange: {
                    start: flow.startTime,
                    end: flow.endTime,
                    duration: new Date(flow.endTime).getTime() - new Date(flow.startTime).getTime()
                },
                status: flow.sourceAction === 'Deny' || flow.destAction === 'Deny' ? '🚨 BLOCKED' : '✅ ALLOWED'
            }));
            // Calculate overall statistics
            const sortedFlows = Array.from(flowMap.values()).sort((a, b) => a.startTime.localeCompare(b.startTime));
            const earliestTime = sortedFlows.length > 0 ? sortedFlows[0].startTime : null;
            const latestTime = sortedFlows.length > 0 ? sortedFlows[sortedFlows.length - 1].endTime : null;
            const totalTraffic = flows.reduce((acc, flow) => ({
                packets: acc.packets + flow.traffic.packets.total,
                bytes: acc.bytes + flow.traffic.bytes.total
            }), { packets: 0, bytes: 0 });
            const blockedFlows = flows.filter(flow => flow.status.includes('BLOCKED'));
            const allowedFlows = flows.filter(flow => flow.status.includes('ALLOWED'));
            // Calculate policy statistics
            const allPolicies = flows.flatMap(flow => flow.enforcement.policyDetails);
            const uniquePolicyNames = [...new Set(allPolicies.map(p => `${p.name} (${p.namespace})`))];
            const policyTiers = [...new Set(allPolicies.map(p => p.tier))].filter(t => t);
            const policyKinds = [...new Set(allPolicies.map(p => p.kind))].filter(k => k);
            const summary = {
                namespace,
                analysis: {
                    totalUniqueFlows: flowMap.size,
                    totalLogEntries: namespaceLogs.length,
                    timeWindow: {
                        start: earliestTime,
                        end: latestTime,
                        duration: earliestTime && latestTime ? new Date(latestTime).getTime() - new Date(earliestTime).getTime() : null
                    }
                },
                statistics: {
                    flows: {
                        total: flows.length,
                        allowed: allowedFlows.length,
                        blocked: blockedFlows.length
                    },
                    traffic: {
                        totalPackets: totalTraffic.packets,
                        totalBytes: totalTraffic.bytes
                    },
                    policies: {
                        totalPolicyApplications: allPolicies.length,
                        uniquePolicies: uniquePolicyNames.length,
                        uniquePolicyNames: uniquePolicyNames.sort(),
                        tiers: policyTiers.sort(),
                        kinds: policyKinds.sort()
                    }
                },
                flows,
                securityAlerts: blockedFlows.length > 0 ? {
                    message: `🚨 ${blockedFlows.length} blocked flow(s) detected - immediate attention required!`,
                    blockedFlows: blockedFlows.map(flow => `${flow.source.name} → ${flow.destination.name}:${flow.connection.port}`)
                } : null
            };
            return JSON.stringify(summary, null, 2);
        }
        catch (error) {
            throw new Error(`Failed to generate flow summary: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    async stopPortForward() {
        if (this.portForwardProcess) {
            this.portForwardProcess.kill();
            this.portForwardProcess = null;
        }
    }
    isPortForwardRunning() {
        return this.portForwardProcess !== null && this.portForwardProcess.pid !== undefined;
    }
    async killExistingPortForwards() {
        return new Promise((resolve) => {
            // Use lsof to find processes using port 8081
            const lsofProcess = spawn('lsof', ['-ti:8081']);
            let pids = '';
            lsofProcess.stdout?.on('data', (data) => {
                pids += data.toString();
            });
            lsofProcess.on('close', (code) => {
                if (code === 0 && pids.trim()) {
                    // Found processes using port 8081, kill them
                    const pidList = pids.trim().split('\n').filter(pid => pid);
                    console.error(`Found ${pidList.length} process(es) using port 8081, killing them...`);
                    let killedCount = 0;
                    pidList.forEach(pid => {
                        try {
                            const killProcess = spawn('kill', ['-9', pid]);
                            killProcess.on('close', (killCode) => {
                                if (killCode === 0) {
                                    console.error(`Successfully killed process ${pid}`);
                                    killedCount++;
                                }
                                else {
                                    console.error(`Failed to kill process ${pid}`);
                                }
                                // Resolve when all processes have been attempted
                                if (killedCount === pidList.length) {
                                    console.error(`✓ Port 8081 cleanup completed. Killed ${killedCount} process(es).`);
                                }
                            });
                        }
                        catch (error) {
                            console.error(`Error killing process ${pid}:`, error);
                        }
                    });
                    // Wait a bit for processes to be killed
                    setTimeout(() => {
                        resolve();
                    }, 1000);
                }
                else {
                    // No processes found using port 8081, continue
                    console.error('Port 8081 is available for use');
                    resolve();
                }
            });
            lsofProcess.on('error', (error) => {
                // lsof command failed, but continue anyway
                console.error('Warning: Could not check for existing processes on port 8081:', error);
                resolve();
            });
        });
    }
    async checkWhiskerServiceStatus() {
        return new Promise((resolve) => {
            const args = ['get', 'service', 'whisker', '-n', 'calico-system', '-o', 'json'];
            if (this.kubeconfigPath) {
                args.unshift('--kubeconfig', this.kubeconfigPath);
            }
            const process = spawn('kubectl', args);
            let stdout = '';
            let stderr = '';
            process.stdout?.on('data', (data) => {
                stdout += data.toString();
            });
            process.stderr?.on('data', (data) => {
                stderr += data.toString();
            });
            process.on('close', (code) => {
                if (code === 0) {
                    try {
                        const service = JSON.parse(stdout);
                        const ports = service.spec?.ports || [];
                        const whiskerPort = ports.find((p) => p.port === 8081 || p.targetPort === 8081);
                        resolve({
                            available: true,
                            details: `Service found with ${ports.length} port(s). Whisker port: ${whiskerPort ? '8081 available' : 'Port 8081 not found'}`
                        });
                    }
                    catch (error) {
                        resolve({
                            available: false,
                            details: 'Service found but could not parse details'
                        });
                    }
                }
                else {
                    resolve({
                        available: false,
                        details: stderr.includes('not found') ? 'Whisker service not found in calico-system namespace' : `Error: ${stderr.trim()}`
                    });
                }
            });
            process.on('error', () => {
                resolve({
                    available: false,
                    details: 'kubectl command failed'
                });
            });
        });
    }
    async analyzeBlockedFlows(namespace) {
        try {
            // Get all flow logs
            const allLogs = await this.getFlowLogs();
            // Filter for blocked flows (action === 'Deny')
            let blockedLogs = allLogs.filter(log => log.action === 'Deny');
            // If namespace is specified, filter by namespace
            if (namespace) {
                blockedLogs = blockedLogs.filter(log => log.source_namespace === namespace || log.dest_namespace === namespace);
            }
            if (blockedLogs.length === 0) {
                return JSON.stringify({
                    namespace: namespace || 'all',
                    message: 'No blocked flows found',
                    blockedFlows: []
                }, null, 2);
            }
            // Analyze each blocked flow and identify blocking policies
            const analysisResults = await Promise.all(blockedLogs.map(async (log) => {
                const blockingPolicies = [];
                // Extract blocking policies from pending triggers
                if (log.policies?.pending) {
                    for (const pendingPolicy of log.policies.pending) {
                        if (pendingPolicy.trigger && pendingPolicy.trigger.name) {
                            try {
                                // Retrieve the actual policy that's causing the block
                                const policyDetails = await this.retrievePolicyDetails(pendingPolicy.trigger.name, pendingPolicy.trigger.namespace, pendingPolicy.trigger.kind);
                                blockingPolicies.push({
                                    triggerPolicy: pendingPolicy.trigger,
                                    policyYaml: policyDetails,
                                    blockingReason: pendingPolicy.action === 'Deny' ? 'Explicit deny rule' : 'End of tier default deny'
                                });
                            }
                            catch (error) {
                                blockingPolicies.push({
                                    triggerPolicy: pendingPolicy.trigger,
                                    policyYaml: null,
                                    error: `Failed to retrieve policy: ${error instanceof Error ? error.message : String(error)}`,
                                    blockingReason: pendingPolicy.action === 'Deny' ? 'Explicit deny rule' : 'End of tier default deny'
                                });
                            }
                        }
                    }
                }
                // Also check enforced policies for additional context
                if (log.policies?.enforced) {
                    for (const enforcedPolicy of log.policies.enforced) {
                        if (enforcedPolicy.action === 'Deny' && enforcedPolicy.trigger && enforcedPolicy.trigger.name) {
                            try {
                                const policyDetails = await this.retrievePolicyDetails(enforcedPolicy.trigger.name, enforcedPolicy.trigger.namespace, enforcedPolicy.trigger.kind);
                                blockingPolicies.push({
                                    triggerPolicy: enforcedPolicy.trigger,
                                    policyYaml: policyDetails,
                                    blockingReason: 'Enforced deny rule'
                                });
                            }
                            catch (error) {
                                blockingPolicies.push({
                                    triggerPolicy: enforcedPolicy.trigger,
                                    policyYaml: null,
                                    error: `Failed to retrieve policy: ${error instanceof Error ? error.message : String(error)}`,
                                    blockingReason: 'Enforced deny rule'
                                });
                            }
                        }
                    }
                }
                return {
                    flow: {
                        source: `${log.source_name} (${log.source_namespace})`,
                        destination: `${log.dest_name} (${log.dest_namespace})`,
                        protocol: log.protocol,
                        port: log.dest_port,
                        action: log.action,
                        reporter: log.reporter,
                        timeRange: `${log.start_time} to ${log.end_time}`
                    },
                    traffic: {
                        packetsIn: log.packets_in,
                        packetsOut: log.packets_out,
                        bytesIn: log.bytes_in,
                        bytesOut: log.bytes_out
                    },
                    blockingPolicies,
                    analysis: {
                        totalBlockingPolicies: blockingPolicies.length,
                        recommendation: blockingPolicies.length > 0
                            ? 'Review the identified policies to understand why traffic is being blocked. Consider modifying the policy rules if this traffic should be allowed.'
                            : 'No specific blocking policies identified. This may be due to default deny behavior or policy ordering.'
                    }
                };
            }));
            const summary = {
                namespace: namespace || 'all',
                analysis: {
                    totalBlockedFlows: blockedLogs.length,
                    uniqueBlockedConnections: [...new Set(blockedLogs.map(log => `${log.source_name}→${log.dest_name}:${log.dest_port}`))].length,
                    timeWindow: {
                        start: Math.min(...blockedLogs.map(log => new Date(log.start_time).getTime())),
                        end: Math.max(...blockedLogs.map(log => new Date(log.end_time).getTime()))
                    }
                },
                blockedFlows: analysisResults,
                securityInsights: {
                    message: `🚨 ${blockedLogs.length} blocked flow(s) detected`,
                    recommendations: [
                        'Review each blocking policy to ensure it aligns with your security requirements',
                        'Consider if any blocked flows represent legitimate traffic that should be allowed',
                        'Verify that policy ordering and tier configuration are correct',
                        'Monitor for patterns that might indicate security threats or misconfigurations'
                    ]
                }
            };
            return JSON.stringify(summary, null, 2);
        }
        catch (error) {
            throw new Error(`Failed to analyze blocked flows: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    async retrievePolicyDetails(policyName, policyNamespace, policyKind) {
        return new Promise((resolve) => {
            let resourceType = '';
            // Map policy kind to kubectl resource type
            switch (policyKind) {
                case 'CalicoNetworkPolicy':
                    resourceType = 'caliconetworkpolicy';
                    break;
                case 'NetworkPolicy':
                    resourceType = 'networkpolicy';
                    break;
                case 'GlobalNetworkPolicy':
                    resourceType = 'globalnetworkpolicy';
                    break;
                default:
                    resolve(null);
                    return;
            }
            const args = ['get', resourceType, policyName, '-o', 'yaml'];
            // Add namespace if specified and not a global policy
            if (policyNamespace && policyKind !== 'GlobalNetworkPolicy') {
                args.push('-n', policyNamespace);
            }
            // Add kubeconfig if specified
            if (this.kubeconfigPath) {
                args.unshift('--kubeconfig', this.kubeconfigPath);
            }
            const process = spawn('kubectl', args);
            let stdout = '';
            let stderr = '';
            process.stdout?.on('data', (data) => {
                stdout += data.toString();
            });
            process.stderr?.on('data', (data) => {
                stderr += data.toString();
            });
            process.on('close', (code) => {
                if (code === 0) {
                    resolve(stdout.trim());
                }
                else {
                    resolve(null);
                }
            });
            process.on('error', () => {
                resolve(null);
            });
            // Timeout after 10 seconds
            setTimeout(() => {
                process.kill();
                resolve(null);
            }, 10000);
        });
    }
}
//# sourceMappingURL=calico-whisker.js.map