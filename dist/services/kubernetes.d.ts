export declare class KubernetesService {
    private currentContext;
    private kubeconfigPath;
    connect(context?: string, kubeconfigPath?: string): Promise<void>;
    private setContext;
    private verifyConnection;
    checkCalicoWhiskerInstalled(): Promise<boolean>;
    getAvailableContexts(kubeconfigPath?: string): Promise<ContextInfo[]>;
    getCurrentContextInfo(kubeconfigPath?: string): Promise<ContextInfo | null>;
    getDefaultKubeconfigPath(): string;
    kubeconfigExists(kubeconfigPath?: string): boolean;
    private parseKubeConfig;
    getCurrentContext(): string | null;
    getKubeconfigPath(): string | null;
    checkServerAccessibility(contextInfo?: any): Promise<{
        accessible: boolean;
        error?: string;
    }>;
    checkWhiskerService(): Promise<{
        available: boolean;
        details: string;
    }>;
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
//# sourceMappingURL=kubernetes.d.ts.map