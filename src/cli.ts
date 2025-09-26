#!/usr/bin/env node

import { Command } from 'commander';
import { CalicoWhiskerService } from './services/calico-whisker.js';
import { KubernetesService } from './services/kubernetes.js';
import { LogFilterService } from './services/log-filter.js';

const program = new Command();

program
  .name('calico-whisker-mcp')
  .description('CLI for Calico Whisker MCP Server testing')
  .version('1.0.0');

program
  .command('connect')
  .description('Connect to Kubernetes cluster and set up port-forwarding')
  .option('-c, --context <context>', 'Kubernetes context name')
  .option('-k, --kubeconfig <path>', 'Path to kubeconfig file')
  .action(async (options) => {
    try {
      const k8sService = new KubernetesService();
      const calicoService = new CalicoWhiskerService();

      console.log('Connecting to Kubernetes cluster...');
      await k8sService.connect(options.context, options.kubeconfig);

      console.log('Setting up port-forwarding to Calico Whisker...');
      await calicoService.setupPortForward(options.kubeconfig);

      console.log('✅ Successfully connected and set up port-forwarding');
      console.log('Port-forward is running on localhost:8081');
      
      // Keep the process running
      process.on('SIGINT', async () => {
        console.log('\nStopping port-forward...');
        await calicoService.stopPortForward();
        process.exit(0);
      });
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command('logs')
  .description('Get flow logs with optional filtering')
  .option('-f, --filter <jq-filter>', 'JQ filter expression')
  .option('-s, --start-time <time>', 'Start time (ISO 8601 format)')
  .option('-e, --end-time <time>', 'End time (ISO 8601 format)')
  .action(async (options) => {
    try {
      const calicoService = new CalicoWhiskerService();
      const logFilterService = new LogFilterService();

      console.log('Fetching flow logs...');
      const logs = await calicoService.getFlowLogs();
      
      console.log(`Found ${logs.length} flow logs`);
      
      if (options.filter || options.startTime || options.endTime) {
        console.log('Applying filters...');
        const filteredLogs = await logFilterService.filterLogs(
          logs,
          options.filter,
          options.startTime,
          options.endTime
        );
        console.log(`Filtered to ${filteredLogs.length} logs`);
        console.log(JSON.stringify(filteredLogs, null, 2));
      } else {
        console.log(JSON.stringify(logs, null, 2));
      }
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command('denied-policies')
  .description('Get flow logs for denied staged policies')
  .option('-n, --namespace <namespace>', 'Filter by namespace')
  .option('-s, --source-name <name>', 'Filter by source name')
  .option('-d, --dest-name <name>', 'Filter by destination name')
  .action(async (options) => {
    try {
      const calicoService = new CalicoWhiskerService();
      const logFilterService = new LogFilterService();

      console.log('Fetching flow logs for denied staged policies...');
      const logs = await calicoService.getFlowLogs();
      
      const filter = logFilterService.buildDeniedStagedPoliciesFilter(
        options.namespace,
        options.sourceName,
        options.destName
      );
      
      const filteredLogs = await logFilterService.filterLogs(logs, filter);
      
      console.log(`Found ${filteredLogs.length} logs matching denied staged policies`);
      console.log(JSON.stringify(filteredLogs, null, 2));
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command('high-traffic')
  .description('Get flow logs with high traffic volume')
  .option('-p, --min-packets <number>', 'Minimum packets', '1000')
  .option('-b, --min-bytes <number>', 'Minimum bytes', '100000')
  .action(async (options) => {
    try {
      const calicoService = new CalicoWhiskerService();
      const logFilterService = new LogFilterService();

      console.log('Fetching high traffic flow logs...');
      const logs = await calicoService.getFlowLogs();
      
      const filter = logFilterService.buildHighTrafficFilter(
        parseInt(options.minPackets),
        parseInt(options.minBytes)
      );
      
      const filteredLogs = await logFilterService.filterLogs(logs, filter);
      
      console.log(`Found ${filteredLogs.length} high traffic flows`);
      console.log(JSON.stringify(filteredLogs, null, 2));
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command('check-deps')
  .description('Check if required dependencies are available')
  .action(async () => {
    const logFilterService = new LogFilterService();
    
    console.log('Checking dependencies...');
    
    const jqAvailable = await logFilterService.checkJqAvailable();
    console.log(`jq: ${jqAvailable ? '✅ Available' : '❌ Not found'}`);
    
    // Check kubectl
    const { spawn } = await import('child_process');
    const kubectlCheck = new Promise<boolean>((resolve) => {
      const process = spawn('kubectl', ['version', '--client']);
      process.on('close', (code) => resolve(code === 0));
      process.on('error', () => resolve(false));
    });
    
    const kubectlAvailable = await kubectlCheck;
    console.log(`kubectl: ${kubectlAvailable ? '✅ Available' : '❌ Not found'}`);
    
    if (!jqAvailable) {
      console.log('\nTo install jq:');
      console.log('  macOS: brew install jq');
      console.log('  Ubuntu/Debian: sudo apt-get install jq');
      console.log('  CentOS/RHEL: sudo yum install jq');
    }
    
    if (!kubectlAvailable) {
      console.log('\nTo install kubectl, visit: https://kubernetes.io/docs/tasks/tools/');
    }
  });

program
  .command('namespace-flows')
  .description('Get flow logs for a specific namespace')
  .option('-n, --namespace <namespace>', 'Namespace to filter by')
  .action(async (options) => {
    try {
      if (!options.namespace) {
        console.error('❌ Error: --namespace is required');
        process.exit(1);
      }

      const calicoService = new CalicoWhiskerService();
      const logFilterService = new LogFilterService();

      console.log(`Fetching flow logs for namespace: ${options.namespace}...`);
      const logs = await calicoService.getFlowLogs();
      
      const filter = logFilterService.buildNamespaceFilter(options.namespace);
      const filteredLogs = await logFilterService.filterLogs(logs, filter);
      
      console.log(`Found ${filteredLogs.length} logs for namespace ${options.namespace}`);
      console.log(JSON.stringify(filteredLogs, null, 2));
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command('generate-policies')
  .description('Analyze flow logs and provide aggregated data for network policy generation')
  .option('-n, --namespace <namespace>', 'Namespace to analyze flows for')
  .option('-k, --selector-key <key>', 'Label key to use for workload grouping (e.g., app, service)')
  .action(async (options) => {
    try {
      if (!options.namespace) {
        console.error('❌ Error: --namespace is required');
        process.exit(1);
      }
      
      if (!options.selectorKey) {
        console.error('❌ Error: --selector-key is required');
        console.error('   Example: --selector-key app');
        console.error('   Example: --selector-key service');
        process.exit(1);
      }

      const calicoService = new CalicoWhiskerService();
      const logFilterService = new LogFilterService();

      console.log(`Analyzing flow logs for namespace: ${options.namespace}...`);
      console.log(`Using selector key: ${options.selectorKey}`);
      
      const logs = await calicoService.getFlowLogs();
      const aggregatedLogs = logFilterService.aggregateLogsForPolicyGeneration(logs, options.namespace);
      
      const response = {
        namespace: options.namespace,
        selectorKey: options.selectorKey,
        aggregatedFlows: aggregatedLogs,
        summary: {
          totalUniqueFlows: aggregatedLogs.length,
          analysisNote: "Use this aggregated data to manually create network policies based on observed traffic patterns"
        }
      };
      
      console.log(`✅ Analyzed ${aggregatedLogs.length} unique flows for policy generation`);
      console.log(JSON.stringify(response, null, 2));
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command('contexts')
  .description('List all available Kubernetes contexts')
  .option('-k, --kubeconfig <path>', 'Path to kubeconfig file')
  .action(async (options) => {
    try {
      const k8sService = new KubernetesService();
      
      console.log('Reading kubeconfig contexts...');
      const contexts = await k8sService.getAvailableContexts(options.kubeconfig);
      
      console.log(`\n📋 Found ${contexts.length} contexts:\n`);
      contexts.forEach(ctx => {
        const marker = ctx.isCurrent ? '✅ [CURRENT]' : '  ';
        console.log(`${marker} ${ctx.name}`);
        console.log(`    Cluster: ${ctx.cluster}`);
        console.log(`    User: ${ctx.user}`);
        if (ctx.namespace) {
          console.log(`    Namespace: ${ctx.namespace}`);
        }
        console.log('');
      });
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command('current-context')
  .description('Show current Kubernetes context information')
  .option('-k, --kubeconfig <path>', 'Path to kubeconfig file')
  .action(async (options) => {
    try {
      const k8sService = new KubernetesService();
      
      console.log('Getting current context information...');
      const currentContext = await k8sService.getCurrentContextInfo(options.kubeconfig);
      
      if (!currentContext) {
        console.log('❌ No current context is set in the kubeconfig file');
        return;
      }
      
      console.log('\n✅ Current Context:');
      console.log(`  Name: ${currentContext.name}`);
      console.log(`  Cluster: ${currentContext.cluster}`);
      console.log(`  User: ${currentContext.user}`);
      if (currentContext.namespace) {
        console.log(`  Namespace: ${currentContext.namespace}`);
      }
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command('check-kubeconfig')
  .description('Check if kubeconfig file exists and is accessible')
  .option('-k, --kubeconfig <path>', 'Path to kubeconfig file')
  .action(async (options) => {
    try {
      const k8sService = new KubernetesService();
      const configPath = options.kubeconfig || k8sService.getDefaultKubeconfigPath();
      
      console.log(`Checking kubeconfig: ${configPath}`);
      
      const exists = k8sService.kubeconfigExists(options.kubeconfig);
      
      if (!exists) {
        console.log('❌ Kubeconfig file not found');
        console.log(`Expected location: ${configPath}`);
        return;
      }
      
      console.log('✅ Kubeconfig file exists');
      
      try {
        const contexts = await k8sService.getAvailableContexts(options.kubeconfig);
        console.log(`✅ Kubeconfig is valid with ${contexts.length} contexts`);
        
        const current = contexts.find(ctx => ctx.isCurrent);
        if (current) {
          console.log(`✅ Current context: ${current.name}`);
        } else {
          console.log('⚠️  No current context set');
        }
      } catch (error) {
        console.log('❌ Kubeconfig file has errors:', error instanceof Error ? error.message : String(error));
      }
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command('test-connection')
  .description('Test full MCP server connection flow and staged deny log retrieval')
  .option('-k, --kubeconfig <path>', 'Path to kubeconfig file')
  .action(async (options) => {
    try {
      const k8sService = new KubernetesService();
      const calicoService = new CalicoWhiskerService();
      const logFilterService = new LogFilterService();
      
      console.log('🔍 Testing MCP Server Connection Flow...\n');
      
      // Test current context
      console.log('1. Checking current context...');
      const currentContext = await k8sService.getCurrentContextInfo(options.kubeconfig);
      if (!currentContext) {
        console.log('❌ No current context set');
        return;
      }
      console.log(`✅ Current context: ${currentContext.name}`);
      
      // Test connectivity
      console.log('\n2. Testing cluster connectivity...');
      await k8sService.connect(undefined, options.kubeconfig);
      console.log('✅ Cluster connection successful');
      
      // Check Calico
      console.log('\n3. Checking Calico installation...');
      const whiskerInstalled = await k8sService.checkCalicoWhiskerInstalled();
      console.log(`${whiskerInstalled ? '✅' : '⚠️'} Calico system: ${whiskerInstalled ? 'Found' : 'Not found'}`);
      
      // Test port-forward
      console.log('\n4. Setting up port-forward...');
      await calicoService.setupPortForward(options.kubeconfig);
      console.log('✅ Port-forward established');
      
      // Test flow logs
      console.log('\n5. Testing flow log retrieval...');
      const logs = await calicoService.getFlowLogs();
      console.log(`✅ Retrieved ${logs.length} flow logs`);
      
      // Test staged deny filtering
      console.log('\n6. Testing staged deny filtering...');
      const filter = logFilterService.buildDeniedStagedPoliciesFilter();
      const deniedLogs = await logFilterService.filterLogs(logs, filter);
      console.log(`✅ Found ${deniedLogs.length} flows with staged deny policies`);
      
      console.log('\n🎉 All tests passed! MCP server is fully functional.');
      
      // Cleanup
      setTimeout(async () => {
        await calicoService.stopPortForward();
        console.log('\n🧹 Port-forward stopped');
        process.exit(0);
      }, 2000);
      
    } catch (error) {
      console.error('❌ Test failed:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command('flow-summary')
  .description('Get aggregated JSON summary of flow logs for a namespace')
  .requiredOption('-n, --namespace <namespace>', 'Namespace to analyze')
  .action(async (options) => {
    try {
      const calicoService = new CalicoWhiskerService();
      
      console.log(`Generating flow summary for namespace: ${options.namespace}`);
      const summary = await calicoService.getNamespaceFlowSummary(options.namespace);
      console.log(summary);
      
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command('analyze-blocked')
  .description('Analyze blocked flows and identify the policies blocking them')
  .option('-n, --namespace <namespace>', 'Filter by namespace (optional)')
  .action(async (options) => {
    try {
      const calicoService = new CalicoWhiskerService();
      
      console.log(`Analyzing blocked flows${options.namespace ? ` for namespace: ${options.namespace}` : ' (all namespaces)'}`);
      const analysis = await calicoService.analyzeBlockedFlows(options.namespace);
      console.log(analysis);
      
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program.parse();