#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { CalicoWhiskerService } from './services/calico-whisker.js';
import { KubernetesService } from './services/kubernetes.js';
import { LogFilterService } from './services/log-filter.js';

export class CalicoWhiskerMCPServer {
  private server: Server;
  private calicoService: CalicoWhiskerService;
  private k8sService: KubernetesService;
  private logFilterService: LogFilterService;

  constructor() {
    this.server = new Server({
      name: 'calico-whisker-mcp-server',
      version: '1.0.0',
    });

    this.calicoService = new CalicoWhiskerService();
    this.k8sService = new KubernetesService();
    this.logFilterService = new LogFilterService();

    this.setupToolHandlers();
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'connect_to_cluster',
            description: 'Connect to a Kubernetes cluster and set up port-forwarding to Calico Whisker',
            inputSchema: {
              type: 'object',
              properties: {
                context: {
                  type: 'string',
                  description: 'Kubernetes context name (optional if kubeconfig is provided)',
                },
                kubeconfig: {
                  type: 'string',
                  description: 'Path to kubeconfig file (optional if context is provided)',
                },
              },
            },
          },
          {
            name: 'get_flow_logs',
            description: 'Retrieve flow logs from Calico Whisker with optional filtering',
            inputSchema: {
              type: 'object',
              properties: {
                filter: {
                  type: 'string',
                  description: 'JQ filter expression to apply to the logs',
                },
                startTime: {
                  type: 'string',
                  description: 'Start time for log filtering (ISO 8601 format)',
                },
                endTime: {
                  type: 'string',
                  description: 'End time for log filtering (ISO 8601 format)',
                },
              },
            },
          },
          {
            name: 'analyze_blocked_flows',
            description: 'PREFERRED TOOL: Analyze denied/blocked/rejected flows and identify root cause policies. Use this tool when users ask to "analyze deny flows", "analyze blocked flows", "investigate denied traffic", "find blocking policies", or similar requests. Provides detailed policy YAML, root cause analysis, and actionable recommendations.',
            inputSchema: {
              type: 'object',
              properties: {
                namespace: {
                  type: 'string',
                  description: 'Filter blocked flows by namespace (optional)',
                },
              },
              'x-mcp-priority': 'high',
              'x-mcp-keywords': ['analyze', 'blocked', 'denied', 'investigate', 'troubleshoot', 'root cause'],
              'x-mcp-use-case': 'blocked-flow-analysis'
            },
          },
          {
            name: 'get_denied_staged_policies',
            description: 'Get flow logs matching staged network policies that would be denied if enforced',
            inputSchema: {
              type: 'object',
              properties: {
                namespace: {
                  type: 'string',
                  description: 'Filter by namespace (optional)',
                },
                sourceName: {
                  type: 'string',
                  description: 'Filter by source name (optional)',
                },
                destName: {
                  type: 'string',
                  description: 'Filter by destination name (optional)',
                },
              },
            },
          },
          // {
          //   name: 'get_policy_violations',
          //   description: 'Get raw flow log data that violate network policies. For detailed analysis of blocked flows, use analyze_blocked_flows instead.',
          //   inputSchema: {
          //     type: 'object',
          //     properties: {
          //       action: {
          //         type: 'string',
          //         description: 'Filter by action (Allow/Deny)',
          //         enum: ['Allow', 'Deny'],
          //       },
          //       namespace: {
          //         type: 'string',
          //         description: 'Filter by namespace',
          //       },
          //       protocol: {
          //         type: 'string',
          //         description: 'Filter by protocol (tcp/udp)',
          //       },
          //     },
          //   },
          // },
          {
            name: 'get_high_traffic_flows',
            description: 'Get flow logs with high traffic volume',
            inputSchema: {
              type: 'object',
              properties: {
                minPackets: {
                  type: 'number',
                  description: 'Minimum number of packets to filter by',
                  default: 1000,
                },
                minBytes: {
                  type: 'number',
                  description: 'Minimum number of bytes to filter by',
                  default: 100000,
                },
              },
            },
          },
          {
            name: 'get_namespace_flows',
            description: 'Get flow logs for a specific namespace (includes flows where namespace is either source or destination)',
            inputSchema: {
              type: 'object',
              properties: {
                namespace: {
                  type: 'string',
                  description: 'The namespace to filter by',
                },
              },
              required: ['namespace'],
            },
          },
          {
            name: 'generate_network_policies',
            description: 'Analyze flow logs and provide aggregated data for network policy generation in a namespace',
            inputSchema: {
              type: 'object',
              properties: {
                namespace: {
                  type: 'string',
                  description: 'The namespace to analyze flows for',
                },
                selectorKey: {
                  type: 'string',
                  description: 'The label key to use for workload grouping (e.g., "app", "service", "component")',
                },
              },
              required: ['namespace', 'selectorKey'],
            },
          },
          {
            name: 'get_kubeconfig_contexts',
            description: 'Get all available contexts from kubeconfig file',
            inputSchema: {
              type: 'object',
              properties: {
                kubeconfigPath: {
                  type: 'string',
                  description: 'Path to kubeconfig file (optional, defaults to ~/.kube/config)',
                },
              },
              required: [],
            },
          },
          {
            name: 'get_current_context',
            description: 'Get information about the current Kubernetes context',
            inputSchema: {
              type: 'object',
              properties: {
                kubeconfigPath: {
                  type: 'string',
                  description: 'Path to kubeconfig file (optional, defaults to ~/.kube/config)',
                },
              },
              required: [],
            },
          },
          {
            name: 'check_kubeconfig',
            description: 'Check if kubeconfig file exists and is accessible',
            inputSchema: {
              type: 'object',
              properties: {
                kubeconfigPath: {
                  type: 'string',
                  description: 'Path to kubeconfig file (optional, defaults to ~/.kube/config)',
                },
              },
              required: [],
            },
          },
          {
            name: 'diagnose_connection',
            description: 'Diagnose Kubernetes and Calico Whisker connectivity issues',
            inputSchema: {
              type: 'object',
              properties: {
                kubeconfigPath: {
                  type: 'string',
                  description: 'Path to kubeconfig file (optional)',
                },
              },
              required: [],
            },
          },
          {
            name: 'get_namespace_flow_summary',
            description: 'Get an aggregated CSV summary of flow logs for a specific namespace',
            inputSchema: {
              type: 'object',
              properties: {
                namespace: {
                  type: 'string',
                  description: 'The namespace to get flow summary for',
                },
              },
              required: ['namespace'],
            },
          },
        ] as Tool[],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'connect_to_cluster':
            return await this.handleConnectToCluster(args);

          case 'get_flow_logs':
            return await this.handleGetFlowLogs(args);

          case 'get_denied_staged_policies':
            return await this.handleGetDeniedStagedPolicies(args);

          // case 'get_policy_violations':
          //   return await this.handleGetPolicyViolations(args);

          case 'get_high_traffic_flows':
            return await this.handleGetHighTrafficFlows(args);

          case 'get_namespace_flows':
            return await this.handleGetNamespaceFlows(args);

          case 'generate_network_policies':
            return await this.handleGenerateNetworkPolicies(args);

          case 'get_kubeconfig_contexts':
            return await this.handleGetKubeconfigContexts(args);

          case 'get_current_context':
            return await this.handleGetCurrentContext(args);

          case 'check_kubeconfig':
            return await this.handleCheckKubeconfig(args);

          case 'diagnose_connection':
            return await this.handleDiagnoseConnection(args);

          case 'get_namespace_flow_summary':
            return await this.handleGetNamespaceFlowSummary(args);

          case 'analyze_blocked_flows':
            return await this.handleAnalyzeBlockedFlows(args);

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error executing tool ${name}: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    });
  }

  private async handleConnectToCluster(args: any) {
    const { context, kubeconfig } = args;
    
    try {
      // Step 1: Connect to Kubernetes
      console.error('Connecting to Kubernetes cluster...');
      await this.k8sService.connect(context, kubeconfig);
      console.error('✅ Kubernetes connection successful');
      
      // Step 2: Check if Whisker service is available
      console.error('Checking Whisker service availability...');
      const serviceStatus = await this.calicoService.checkWhiskerServiceStatus();
      if (!serviceStatus.available) {
        throw new Error(`Whisker service not available: ${serviceStatus.details}`);
      }
      console.error(`✅ Whisker service status: ${serviceStatus.details}`);
      
      // Step 3: Setup port-forward
      console.error('Setting up port-forward to Whisker service...');
      await this.calicoService.setupPortForward(kubeconfig);
      console.error('✅ Port-forward established successfully');
      
      return {
        content: [
          {
            type: 'text',
            text: `✅ Successfully connected to Kubernetes cluster and set up port-forwarding to Calico Whisker on localhost:8081\n\nService Status: ${serviceStatus.details}\n\nYou can now use other tools to retrieve flow logs.`,
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('❌ Connection failed:', errorMessage);
      
      return {
        content: [
          {
            type: 'text',
            text: `❌ Failed to connect to cluster or set up port-forwarding.\n\nError: ${errorMessage}\n\nTroubleshooting steps:\n1. Verify kubectl is configured correctly\n2. Check if the current context is valid\n3. Ensure Calico Whisker is installed and running\n4. Verify you have permissions to access calico-system namespace\n\nYou can check service status with: kubectl get service whisker -n calico-system`,
          },
        ],
      };
    }
  }

  private async handleGetFlowLogs(args: any) {
    const { filter, startTime, endTime } = args;
    
    const logs = await this.calicoService.getFlowLogs();
    const filteredLogs = await this.logFilterService.filterLogs(logs, filter, startTime, endTime);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(filteredLogs, null, 2),
        },
      ],
    };
  }

  private async handleGetDeniedStagedPolicies(args: any) {
    const { namespace, sourceName, destName } = args;
    
    const logs = await this.calicoService.getFlowLogs();
    const filter = this.logFilterService.buildDeniedStagedPoliciesFilter(namespace, sourceName, destName);
    const filteredLogs = await this.logFilterService.filterLogs(logs, filter);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(filteredLogs, null, 2),
        },
      ],
    };
  }

  private async handleGetPolicyViolations(args: any) {
    const { action, namespace, protocol } = args;
    
    const logs = await this.calicoService.getFlowLogs();
    const filter = this.logFilterService.buildPolicyViolationsFilter(action, namespace, protocol);
    const filteredLogs = await this.logFilterService.filterLogs(logs, filter);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(filteredLogs, null, 2),
        },
      ],
    };
  }

  private async handleGetHighTrafficFlows(args: any) {
    const { minPackets = 1000, minBytes = 100000 } = args;
    
    const logs = await this.calicoService.getFlowLogs();
    const filter = this.logFilterService.buildHighTrafficFilter(minPackets, minBytes);
    const filteredLogs = await this.logFilterService.filterLogs(logs, filter);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(filteredLogs, null, 2),
        },
      ],
    };
  }

  private async handleGetNamespaceFlows(args: any) {
    const { namespace } = args;
    
    const logs = await this.calicoService.getFlowLogs();
    const filter = this.logFilterService.buildNamespaceFilter(namespace);
    const filteredLogs = await this.logFilterService.filterLogs(logs, filter);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(filteredLogs, null, 2),
        },
      ],
    };
  }

  private async handleGenerateNetworkPolicies(args: any) {
    const { namespace, selectorKey } = args;
    
    if (!selectorKey) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: selectorKey is required. Please provide a label key to use for workload grouping (e.g., "app", "service", "component").',
          },
        ],
      };
    }
    
    const logs = await this.calicoService.getFlowLogs();
    const aggregatedLogs = this.logFilterService.aggregateLogsForPolicyGeneration(logs, namespace);
    
    const response = {
      namespace: namespace,
      selectorKey: selectorKey,
      aggregatedFlows: aggregatedLogs,
      summary: {
        totalUniqueFlows: aggregatedLogs.length,
        analysisNote: "Use this aggregated data to manually create network policies based on observed traffic patterns"
      }
    };
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  }

  private async handleGetKubeconfigContexts(args: any) {
    const { kubeconfigPath } = args;
    
    try {
      const contexts = await this.k8sService.getAvailableContexts(kubeconfigPath);
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              kubeconfigPath: kubeconfigPath || this.k8sService.getDefaultKubeconfigPath(),
              contexts: contexts,
              currentContext: contexts.find(ctx => ctx.isCurrent)?.name || null,
              totalContexts: contexts.length
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error reading kubeconfig: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }

  private async handleGetCurrentContext(args: any) {
    const { kubeconfigPath } = args;
    
    try {
      const currentContext = await this.k8sService.getCurrentContextInfo(kubeconfigPath);
      
      if (!currentContext) {
        return {
          content: [
            {
              type: 'text',
              text: 'No current context is set in the kubeconfig file.',
            },
          ],
        };
      }
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              kubeconfigPath: kubeconfigPath || this.k8sService.getDefaultKubeconfigPath(),
              currentContext: currentContext
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting current context: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }

  private async handleCheckKubeconfig(args: any) {
    const { kubeconfigPath } = args;
    const configPath = kubeconfigPath || this.k8sService.getDefaultKubeconfigPath();
    
    const exists = this.k8sService.kubeconfigExists(kubeconfigPath);
    
    let contexts: any[] = [];
    let error: string | null = null;
    
    if (exists) {
      try {
        contexts = await this.k8sService.getAvailableContexts(kubeconfigPath);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
    }
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            kubeconfigPath: configPath,
            exists: exists,
            accessible: exists && error === null,
            error: error,
            contextCount: contexts.length,
            status: exists 
              ? (error === null ? 'Valid kubeconfig file' : 'File exists but has errors') 
              : 'Kubeconfig file not found'
          }, null, 2),
        },
      ],
    };
  }

  private async handleDiagnoseConnection(args: any) {
    const { kubeconfigPath } = args;
    const configPath = kubeconfigPath || this.k8sService.getDefaultKubeconfigPath();
    
    try {
      // Check if kubeconfig file exists
      const exists = this.k8sService.kubeconfigExists(configPath);
      if (!exists) {
        return {
          content: [
            {
              type: 'text',
              text: `Kubeconfig file not found at path: ${configPath}`,
            },
          ],
        };
      }
      
      // Get current context
      const currentContext = await this.k8sService.getCurrentContextInfo(configPath);
      
      // Check Kubernetes server accessibility
      const serverAccessible = await this.k8sService.checkServerAccessibility(currentContext);
      
      // Check Whisker service status
      const serviceStatus = await this.calicoService.checkWhiskerServiceStatus();
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              kubeconfigPath: configPath,
              currentContext: currentContext,
              serverAccessible: serverAccessible,
              whiskerServiceStatus: serviceStatus,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error diagnosing connection: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }

  private async handleGetNamespaceFlowSummary(args: any) {
    const { namespace } = args;
    
    if (!namespace) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: namespace parameter is required',
          },
        ],
      };
    }

    try {
      const summary = await this.calicoService.getNamespaceFlowSummary(namespace);
      
      return {
        content: [
          {
            type: 'text',
            text: summary,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error generating flow summary for namespace ${namespace}: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }

  private async handleAnalyzeBlockedFlows(args: any) {
    const { namespace } = args;
    
    try {
      // This method implements the logic you requested:
      // 1. Detects blocked flows (action === 'Deny')
      // 2. Examines pending triggers to identify blocking policies
      // 3. Retrieves actual policy YAML using kubectl
      // 4. Provides detailed analysis for MCP client
      const analysis = await this.calicoService.analyzeBlockedFlows(namespace);
      
      return {
        content: [
          {
            type: 'text',
            text: analysis,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error analyzing blocked flows${namespace ? ` for namespace ${namespace}` : ''}: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Calico Whisker MCP Server started');
  }
}

// Start the server
const server = new CalicoWhiskerMCPServer();
server.run().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});