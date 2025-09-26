import { spawn } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import * as yaml from 'js-yaml';

const DEFAULT_PATH = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
function getEnvWithPath() {
  // Defensive: ensure process.env exists and merge with a default PATH
  const env = { ...(process.env || {}), PATH: (process.env && process.env.PATH) ? process.env.PATH : DEFAULT_PATH };
  return env;
}

export class KubernetesService {
  private currentContext: string | null = null;
  private kubeconfigPath: string | null = null;

  async connect(context?: string, kubeconfigPath?: string): Promise<void> {
    // Set kubeconfig path
    if (kubeconfigPath) {
      this.kubeconfigPath = kubeconfigPath;
    } else {
      // Use default kubeconfig location
      this.kubeconfigPath = join(homedir(), '.kube', 'config');
    }

    // Set context if provided
    if (context) {
      await this.setContext(context);
    }

    // Verify connection
    await this.verifyConnection();
  }

  private async setContext(context: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = ['config', 'use-context', context];
      if (this.kubeconfigPath) {
        args.unshift('--kubeconfig', this.kubeconfigPath);
      }
      const env = getEnvWithPath();
      console.error('Spawning kubectl for setContext with PATH:', env.PATH);
      const process = spawn('kubectl', args, { env });

      process.on('close', (code) => {
        if (code === 0) {
          this.currentContext = context;
          resolve();
        } else {
          reject(new Error(`Failed to set context to ${context}`));
        }
      });

      process.on('error', (error) => {
        reject(new Error(`Failed to execute kubectl: ${error.message}`));
      });
    });
  }

  private async verifyConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = ['cluster-info'];
      if (this.kubeconfigPath) {
        args.unshift('--kubeconfig', this.kubeconfigPath);
      }
      const env = getEnvWithPath();
      console.error('Spawning kubectl for verifyConnection with PATH:', env.PATH);
      const process = spawn('kubectl', args, { env });

      let stderr = '';
      process.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          console.error('kubectl verifyConnection stderr:', stderr);
          reject(new Error('Failed to connect to Kubernetes cluster: ' + stderr));
        }
      });

      process.on('error', (error) => {
        reject(new Error(`Failed to execute kubectl: ${error.message}`));
      });
    });
  }

  async checkCalicoWhiskerInstalled(): Promise<boolean> {
    return new Promise((resolve) => {
      const args = ['get', 'namespace', 'calico-system'];
      if (this.kubeconfigPath) {
        args.unshift('--kubeconfig', this.kubeconfigPath);
      }
      const env = getEnvWithPath();
      console.error('Spawning kubectl for checkCalicoWhiskerInstalled with PATH:', env.PATH);
      const process = spawn('kubectl', args, { env });

      process.on('close', (code) => {
        resolve(code === 0);
      });

      process.on('error', () => {
        resolve(false);
      });
    });
  }

  async getAvailableContexts(kubeconfigPath?: string): Promise<ContextInfo[]> {
    const configPath = kubeconfigPath || this.kubeconfigPath || join(homedir(), '.kube', 'config');
    
    try {
      const kubeconfig = this.parseKubeConfig(configPath);
      return kubeconfig.contexts.map(ctx => ({
        name: ctx.name,
        cluster: ctx.context.cluster,
        user: ctx.context.user,
        namespace: ctx.context.namespace,
        isCurrent: ctx.name === kubeconfig['current-context']
      }));
    } catch (error) {
      throw new Error(`Failed to parse kubeconfig: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getCurrentContextInfo(kubeconfigPath?: string): Promise<ContextInfo | null> {
    const configPath = kubeconfigPath || this.kubeconfigPath || join(homedir(), '.kube', 'config');
    
    try {
      const kubeconfig = this.parseKubeConfig(configPath);
      const currentContextName = kubeconfig['current-context'];
      
      if (!currentContextName) {
        return null;
      }
      
      const currentContext = kubeconfig.contexts.find(ctx => ctx.name === currentContextName);
      if (!currentContext) {
        return null;
      }
      
      return {
        name: currentContext.name,
        cluster: currentContext.context.cluster,
        user: currentContext.context.user,
        namespace: currentContext.context.namespace,
        isCurrent: true
      };
    } catch (error) {
      throw new Error(`Failed to get current context info: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  getDefaultKubeconfigPath(): string {
    return join(homedir(), '.kube', 'config');
  }

  kubeconfigExists(kubeconfigPath?: string): boolean {
    const configPath = kubeconfigPath || this.getDefaultKubeconfigPath();
    return existsSync(configPath);
  }

  private parseKubeConfig(kubeconfigPath: string): KubeConfig {
    if (!existsSync(kubeconfigPath)) {
      throw new Error(`Kubeconfig file not found at: ${kubeconfigPath}`);
    }
    
    try {
      const configContent = readFileSync(kubeconfigPath, 'utf8');
      const kubeconfig = yaml.load(configContent) as KubeConfig;
      
      if (!kubeconfig || !kubeconfig.contexts) {
        throw new Error('Invalid kubeconfig format: missing contexts');
      }
      
      return kubeconfig;
    } catch (error) {
      if (error instanceof yaml.YAMLException) {
        throw new Error(`Invalid YAML in kubeconfig: ${error.message}`);
      }
      throw error;
    }
  }

  getCurrentContext(): string | null {
    return this.currentContext;
  }

  getKubeconfigPath(): string | null {
    return this.kubeconfigPath;
  }

  async checkServerAccessibility(contextInfo?: any): Promise<{ accessible: boolean; error?: string }> {
    return new Promise((resolve) => {
      const args = ['cluster-info'];
      if (this.kubeconfigPath) {
        args.unshift('--kubeconfig', this.kubeconfigPath);
      }
      if (contextInfo?.name) {
        args.push('--context', contextInfo.name);
      }

      const env = getEnvWithPath();
      const process = spawn('kubectl', args, { env });

      let stderr = '';
      process.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve({ accessible: true });
        } else {
          resolve({ 
            accessible: false, 
            error: stderr || `kubectl exited with code ${code}` 
          });
        }
      });

      process.on('error', (error) => {
        resolve({ 
          accessible: false, 
          error: `Failed to execute kubectl: ${error.message}` 
        });
      });
    });
  }

  async checkWhiskerService(): Promise<{ available: boolean; details: string }> {
    return new Promise((resolve) => {
      const args = ['get', 'service', 'whisker', '-n', 'calico-system', '-o', 'json'];
      if (this.kubeconfigPath) {
        args.unshift('--kubeconfig', this.kubeconfigPath);
      }
      const env = getEnvWithPath();
      const process = spawn('kubectl', args, { env });

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
            const whiskerPort = ports.find((p: any) => p.port === 8081 || p.targetPort === 8081);
            
            resolve({
              available: true,
              details: `Service found with ${ports.length} port(s). Whisker port: ${whiskerPort ? 'Available' : 'Not found'}`
            });
          } catch (error) {
            resolve({
              available: false,
              details: 'Service found but could not parse details'
            });
          }
        } else {
          resolve({
            available: false,
            details: stderr.includes('not found') ? 'Whisker service not found' : `Error: ${stderr}`
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
}

export interface KubeConfigContext {
  name: string;
  context: {
    cluster: string;
    namespace?: string;
    user: string;
  };
}

export interface KubeConfigCluster {
  name: string;
  cluster: {
    server: string;
    'certificate-authority'?: string;
    'certificate-authority-data'?: string;
    'insecure-skip-tls-verify'?: boolean;
  };
}

export interface KubeConfigUser {
  name: string;
  user: {
    'client-certificate'?: string;
    'client-certificate-data'?: string;
    'client-key'?: string;
    'client-key-data'?: string;
    token?: string;
    username?: string;
    password?: string;
    exec?: any;
  };
}

export interface KubeConfig {
  apiVersion: string;
  kind: string;
  'current-context': string;
  contexts: KubeConfigContext[];
  clusters: KubeConfigCluster[];
  users: KubeConfigUser[];
}

export interface ContextInfo {
  name: string;
  cluster: string;
  user: string;
  namespace?: string;
  isCurrent: boolean;
}