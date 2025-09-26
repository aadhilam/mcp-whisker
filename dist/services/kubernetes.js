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
    currentContext = null;
    kubeconfigPath = null;
    async connect(context, kubeconfigPath) {
        // Set kubeconfig path
        if (kubeconfigPath) {
            this.kubeconfigPath = kubeconfigPath;
        }
        else {
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
    async setContext(context) {
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
                }
                else {
                    reject(new Error(`Failed to set context to ${context}`));
                }
            });
            process.on('error', (error) => {
                reject(new Error(`Failed to execute kubectl: ${error.message}`));
            });
        });
    }
    async verifyConnection() {
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
                }
                else {
                    console.error('kubectl verifyConnection stderr:', stderr);
                    reject(new Error('Failed to connect to Kubernetes cluster: ' + stderr));
                }
            });
            process.on('error', (error) => {
                reject(new Error(`Failed to execute kubectl: ${error.message}`));
            });
        });
    }
    async checkCalicoWhiskerInstalled() {
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
    async getAvailableContexts(kubeconfigPath) {
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
        }
        catch (error) {
            throw new Error(`Failed to parse kubeconfig: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    async getCurrentContextInfo(kubeconfigPath) {
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
        }
        catch (error) {
            throw new Error(`Failed to get current context info: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    getDefaultKubeconfigPath() {
        return join(homedir(), '.kube', 'config');
    }
    kubeconfigExists(kubeconfigPath) {
        const configPath = kubeconfigPath || this.getDefaultKubeconfigPath();
        return existsSync(configPath);
    }
    parseKubeConfig(kubeconfigPath) {
        if (!existsSync(kubeconfigPath)) {
            throw new Error(`Kubeconfig file not found at: ${kubeconfigPath}`);
        }
        try {
            const configContent = readFileSync(kubeconfigPath, 'utf8');
            const kubeconfig = yaml.load(configContent);
            if (!kubeconfig || !kubeconfig.contexts) {
                throw new Error('Invalid kubeconfig format: missing contexts');
            }
            return kubeconfig;
        }
        catch (error) {
            if (error instanceof yaml.YAMLException) {
                throw new Error(`Invalid YAML in kubeconfig: ${error.message}`);
            }
            throw error;
        }
    }
    getCurrentContext() {
        return this.currentContext;
    }
    getKubeconfigPath() {
        return this.kubeconfigPath;
    }
    async checkServerAccessibility(contextInfo) {
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
                }
                else {
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
    async checkWhiskerService() {
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
                        const whiskerPort = ports.find((p) => p.port === 8081 || p.targetPort === 8081);
                        resolve({
                            available: true,
                            details: `Service found with ${ports.length} port(s). Whisker port: ${whiskerPort ? 'Available' : 'Not found'}`
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
//# sourceMappingURL=kubernetes.js.map