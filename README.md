# Calico Whisker MCP Server

An MCP (Model Context Protocol) server for analyzing Calico Whisker flow logs in Kubernetes clusters.

## Features

- Connect to Kubernetes clusters using context or kubeconfig
- Automatic port-forwarding to Calico Whisker service
- Advanced log filtering using JQ expressions
- Pre-built filters for common analysis scenarios:
  - **Blocked flow analysis with root cause identification** (analyze_blocked_flows)
  - Denied staged network policies
  - Policy violations
  - High traffic flows
- Real-time flow log analysis

## Tool Selection Guide for MCP Clients

**For analyzing blocked/denied flows, always use `analyze_blocked_flows`:**
- Provides policy YAML and root cause analysis
- Offers actionable recommendations
- Most comprehensive for troubleshooting

**Query examples that should use `analyze_blocked_flows`:**
- "analyze deny flows in namespace X"
- "investigate blocked traffic" 
- "find what's blocking this connection"
- "troubleshoot network policy denials"

See [TOOL_SELECTION_GUIDE.md](./TOOL_SELECTION_GUIDE.md) for complete guidance.

## Prerequisites

- Node.js 18+ and npm
- kubectl configured with access to your Kubernetes cluster
- Calico Whisker installed in the `calico-system` namespace
- jq installed for JSON filtering

### Installing jq

**macOS:**
```bash
brew install jq
```

**Ubuntu/Debian:**
```bash
sudo apt-get install jq
```

**CentOS/RHEL:**
```bash
sudo yum install jq
```

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd calico-whisker-mcp-2
```

2. Install dependencies:
```bash
npm install
```

3. Build the project:
```bash
npm run build
```

## Usage

### Starting the MCP Server

```bash
npm start
```

The server will start and listen for MCP client connections via stdio.

### Available Tools

#### 1. connect_to_cluster
Connect to a Kubernetes cluster and set up port-forwarding to Calico Whisker.

**Parameters:**
- `context` (optional): Kubernetes context name
- `kubeconfig` (optional): Path to kubeconfig file

**Example:**
```json
{
  "context": "my-cluster",
  "kubeconfig": "/path/to/kubeconfig"
}
```

#### 2. get_flow_logs
Retrieve flow logs from Calico Whisker with optional filtering.

**Parameters:**
- `filter` (optional): JQ filter expression
- `startTime` (optional): Start time for filtering (ISO 8601 format)
- `endTime` (optional): End time for filtering (ISO 8601 format)

**Example:**
```json
{
  "filter": "select(.action == \"Deny\")",
  "startTime": "2025-01-01T00:00:00Z",
  "endTime": "2025-01-02T00:00:00Z"
}
```

#### 3. get_denied_staged_policies
Get flow logs matching staged network policies that would be denied if enforced.

**Parameters:**
- `namespace` (optional): Filter by namespace
- `sourceName` (optional): Filter by source name
- `destName` (optional): Filter by destination name

**Example:**
```json
{
  "namespace": "yaobank",
  "sourceName": "summary"
}
```

#### 4. get_policy_violations
Get flow logs that violate network policies.

**Parameters:**
- `action` (optional): Filter by action (Allow/Deny)
- `namespace` (optional): Filter by namespace
- `protocol` (optional): Filter by protocol (tcp/udp)

**Example:**
```json
{
  "action": "Deny",
  "namespace": "kube-system",
  "protocol": "tcp"
}
```

#### 5. get_high_traffic_flows
Get flow logs with high traffic volume.

**Parameters:**
- `minPackets` (optional): Minimum number of packets (default: 1000)
- `minBytes` (optional): Minimum number of bytes (default: 100000)

**Example:**
```json
{
  "minPackets": 5000,
  "minBytes": 500000
}
```

## Flow Log Schema

Calico Whisker flow logs contain the following fields:

```json
{
  "start_time": "2025-07-02T22:54:45Z",
  "end_time": "2025-07-02T23:54:45Z",
  "action": "Allow",
  "source_name": "summary-57569999f-*",
  "source_namespace": "yaobank",
  "source_labels": "app=summary | pod-template-hash=57569999f | version=v1",
  "dest_name": "coredns-789465848c-*",
  "dest_namespace": "kube-system",
  "dest_labels": "k8s-app=kube-dns | kubernetes.azure.com/managedby=aks | kubernetes.io/cluster-service=true | pod-template-hash=789465848c | version=v20",
  "protocol": "udp",
  "dest_port": 53,
  "reporter": "Src",
  "policies": {
    "enforced": [...],
    "pending": [...]
  },
  "packets_in": 3554,
  "packets_out": 3566,
  "bytes_in": 538431,
  "bytes_out": 285280
}
```

## JQ Filter Examples

### Filter by Action
```bash
select(.action == "Deny")
```

### Filter by Namespace
```bash
select(.source_namespace == "yaobank" or .dest_namespace == "yaobank")
```

### Filter by Protocol
```bash
select(.protocol == "tcp")
```

### Filter by High Traffic
```bash
select(.packets_in > 1000 or .bytes_in > 100000)
```

### Complex Filter for Staged Policies
```bash
select(.policies.pending != null and (any(.policies.pending[]; .action == "Deny" and .trigger.kind == "StagedNetworkPolicy")))
```

## Development

### Running in Development Mode

```bash
npm run dev
```

### Building

```bash
npm run build
```

### Testing

```bash
npm test
```

## Troubleshooting

### Port-Forward Issues
- Ensure Calico Whisker is installed in the `calico-system` namespace
- Check that the whisker service exists: `kubectl get svc -n calico-system whisker`
- Verify port 8081 is not already in use

### JQ Not Found
- Install jq using your package manager
- Ensure jq is in your PATH

### Kubernetes Connection Issues
- Verify kubectl is configured correctly
- Check cluster access: `kubectl cluster-info`
- Ensure the specified context exists: `kubectl config get-contexts`

## License

MIT