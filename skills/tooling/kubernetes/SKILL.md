---
name: kubernetes
description: Write and review Kubernetes manifests, Helm charts and Kustomize overlays, and operate workloads with kubectl. Covers Deployments, Services, Ingress, resource requests/limits, liveness/readiness probes, ConfigMaps and Secrets, namespaces, rollouts, log/exec debugging of pods, and safety rules for production clusters. Use when a project has Chart.yaml, values.yaml, kustomization.yaml, skaffold.yaml or k8s/ manifests, or when asked to deploy to or debug Kubernetes.
---

# Kubernetes

Assumes Kubernetes 1.28+, `kubectl` matching the cluster minor version (+/-1), Helm 3, and Kustomize (built into `kubectl -k`).

## When to use

- Creating or editing YAML manifests, Helm charts (`Chart.yaml`, `templates/`, `values.yaml`), or Kustomize bases/overlays.
- Deploying, rolling back, scaling or debugging workloads with `kubectl`, `helm` or `skaffold`.
- Reviewing manifests for resource limits, probes, security context and configuration handling.

## Project conventions to detect first

1. Layout: raw manifests (`k8s/`, `deploy/`, `manifests/`), Helm (`charts/<name>/Chart.yaml`), or Kustomize (`base/` + `overlays/<env>/kustomization.yaml`). Do not introduce a second tool.
2. Target cluster and namespace: `kubectl config current-context`, `kubectl config view --minify`, Makefile/CI variables, `skaffold.yaml` profiles. Treat any context whose name contains `prod` as production.
3. Chart or overlay conventions: value names, labels (`app.kubernetes.io/name`, `app.kubernetes.io/instance`), naming templates in `_helpers.tpl`, environment overlays, image tag source (CI sets it, or `kustomize edit set image`).
4. Ingress controller and class (`ingressClassName: nginx`, `traefik`, Gateway API `HTTPRoute`), cert-manager annotations, external-dns.
5. Secrets handling: External Secrets Operator, Sealed Secrets, SOPS, Vault injector, or plain `Secret` objects applied from CI. Never commit plaintext secrets.
6. Policy constraints: Pod Security Admission labels on namespaces, OPA/Kyverno policies, required labels/annotations, resource quotas.

## Core guidance

### Safety rules

- Never run `kubectl delete namespace`, `kubectl delete -f` against shared resources, or `helm uninstall` without explicit user confirmation naming the target.
- Never `kubectl apply`, `helm upgrade` or `kubectl rollout restart` against a production context without confirmation. State the context and namespace before any mutating command: `kubectl config current-context`.
- Prefer `kubectl diff -f` / `helm diff upgrade` (plugin) / `kubectl apply --dry-run=server` before applying.
- Always pass `-n <namespace>` explicitly in commands; do not rely on the current-context default.
- Do not edit live objects with `kubectl edit` in GitOps-managed clusters (Argo CD, Flux); change the manifest in git.

### Deployment manifest

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  labels: { app.kubernetes.io/name: api }
spec:
  replicas: 2
  selector:
    matchLabels: { app.kubernetes.io/name: api }
  strategy:
    rollingUpdate: { maxSurge: 1, maxUnavailable: 0 }
  template:
    metadata:
      labels: { app.kubernetes.io/name: api }
    spec:
      securityContext:
        runAsNonRoot: true
        seccompProfile: { type: RuntimeDefault }
      containers:
        - name: api
          image: registry.example.com/api:1.4.2   # immutable tag, never latest
          ports: [{ name: http, containerPort: 3000 }]
          envFrom:
            - configMapRef: { name: api-config }
            - secretRef: { name: api-secrets }
          resources:
            requests: { cpu: 100m, memory: 256Mi }
            limits: { memory: 256Mi }             # memory limit = request; cpu limit optional
          readinessProbe:
            httpGet: { path: /readyz, port: http }
            periodSeconds: 5
          livenessProbe:
            httpGet: { path: /healthz, port: http }
            initialDelaySeconds: 10
            periodSeconds: 10
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities: { drop: ["ALL"] }
          volumeMounts:
            - { name: tmp, mountPath: /tmp }
      volumes:
        - name: tmp
          emptyDir: {}
```

- Always set `resources.requests`; set a memory `limit` equal to the request to avoid OOM surprises from overcommit. CPU limits cause throttling; omit or set generously unless policy requires them.
- Readiness probe gates traffic; liveness probe restarts the container. Liveness must not depend on downstream services (DB, other APIs) or a DB outage restarts every pod. Use `startupProbe` for slow-starting apps instead of large `initialDelaySeconds`.
- Set `terminationGracePeriodSeconds` to match the app's shutdown time and make the app handle `SIGTERM` and drain.
- Add `PodDisruptionBudget` for anything with `replicas >= 2` and `topologySpreadConstraints` or pod anti-affinity for availability.
- Use `HorizontalPodAutoscaler` based on CPU/memory or custom metrics instead of hand-tuned replica counts in production.

### Services and Ingress

- `Service` of type `ClusterIP` by default; `LoadBalancer` only at the edge; `NodePort` rarely.
- Name ports (`name: http`) and reference them by name in probes and Services.
- Ingress: set `spec.ingressClassName`, TLS via cert-manager annotation (`cert-manager.io/cluster-issuer`), host-based routing. Check which controller is installed: `kubectl get ingressclass`.
- `NetworkPolicy` default-deny in namespaces that already use them; follow the repo's pattern.

### Configuration and secrets

- `ConfigMap` for non-sensitive config, `Secret` for sensitive values; mount as env (`envFrom`) or files. Changing a ConfigMap does not restart pods; use a checksum annotation on the pod template (Helm: `checksum/config: {{ include (print $.Template.BasePath "/configmap.yaml") . | sha256sum }}`) or Kustomize `configMapGenerator` (hash suffix) to trigger rollouts.
- Secrets are base64, not encrypted; rely on the cluster's secret manager and RBAC. Never commit `data:` values; use `stringData:` only in examples with placeholders.
- One namespace per environment or per team; name resources consistently; use `kubectl get all -n <ns>` to see what exists.

### Helm

- `helm lint charts/<name>` and `helm template charts/<name> -f values-<env>.yaml` to render before installing.
- Keep `values.yaml` documented with defaults; environment overrides in separate files, not edits to the chart.
- Use `helm upgrade --install <release> <chart> -n <ns> --create-namespace -f values.yaml --atomic --timeout 5m` so failed upgrades roll back.
- `helm diff upgrade` (plugin: `helm plugin install https://github.com/databus23/helm-diff`) to review changes.
- Do not template secrets from plaintext values files committed to git.

### Kustomize

- `base/` holds shared manifests; `overlays/<env>/kustomization.yaml` patches images, replicas, env. Prefer `patches:` with strategic merge or JSON 6902; avoid `patchesStrategicMerge` (deprecated).
- `kubectl kustomize overlays/prod | less` to inspect output; `kubectl apply -k overlays/dev` to apply.
- Set images with `kustomize edit set image api=registry/api:1.4.2` in CI rather than editing YAML by hand.

## Common tasks

### Deploy a change

1. Confirm context and namespace: `kubectl config current-context; kubectl config view --minify -o jsonpath='{..namespace}'`.
2. Render and review: `kubectl diff -k overlays/dev` or `helm diff upgrade api charts/api -n dev -f values-dev.yaml`.
3. Apply: `kubectl apply -k overlays/dev` or `helm upgrade --install api charts/api -n dev -f values-dev.yaml --atomic`.
4. Watch: `kubectl rollout status deployment/api -n dev --timeout=120s`.
5. Verify: `kubectl get pods -n dev -l app.kubernetes.io/name=api`, check logs and the readiness endpoint.

### Roll back

```bash
kubectl rollout history deployment/api -n dev
kubectl rollout undo deployment/api -n dev --to-revision=<n>
helm history api -n dev && helm rollback api <revision> -n dev
```

### Debug a pod that is not Running or Ready

```bash
kubectl get pods -n <ns> -o wide
kubectl describe pod <pod> -n <ns>            # Events at the bottom: image pull, scheduling, probe failures, OOMKilled
kubectl logs <pod> -n <ns> -c <container> --previous   # logs from the crashed container
kubectl logs -n <ns> -l app.kubernetes.io/name=api --tail=100 -f
kubectl exec -it <pod> -n <ns> -- sh
kubectl debug -it <pod> -n <ns> --image=busybox --target=<container>   # ephemeral container for distroless
kubectl get events -n <ns> --sort-by=.lastTimestamp
kubectl top pods -n <ns>
```

- `ImagePullBackOff`: wrong tag, private registry without `imagePullSecrets`, or wrong architecture.
- `CrashLoopBackOff`: check `--previous` logs; usually config/env/secret missing or the app exits immediately.
- `Pending`: insufficient resources, node selector/taint mismatch, or unbound PVC (`kubectl describe pvc`).
- `OOMKilled` (exit 137): raise memory request/limit or fix a leak.
- Readiness failing: port name mismatch, path returns non-2xx, app listening on `127.0.0.1`.

### Reach a service locally

```bash
kubectl port-forward -n <ns> svc/api 8080:80
kubectl run tmp --rm -it --image=curlimages/curl -n <ns> -- curl -s http://api/healthz
```

### Scale or restart

```bash
kubectl scale deployment/api -n <ns> --replicas=3
kubectl rollout restart deployment/api -n <ns>      # picks up new ConfigMap/Secret values
```

### Inspect config

```bash
kubectl get configmap api-config -n <ns> -o yaml
kubectl get secret api-secrets -n <ns> -o jsonpath='{.data.DATABASE_URL}' | base64 -d   # only when the user asks; do not paste into chat logs
kubectl get deployment api -n <ns> -o yaml | kubectl neat   # if krew neat is installed
```

## Pitfalls

- `image: app:latest` with `imagePullPolicy: IfNotPresent` never updates; use immutable tags or digests.
- Missing requests causes `BestEffort` QoS and first-to-be-evicted pods; missing memory limits allows one pod to starve a node.
- Liveness probes that call the database take the whole fleet down during a DB blip.
- Changing a `Deployment`'s `selector` is immutable; delete and recreate (with confirmation) or use a new name.
- `kubectl apply` on objects created with `kubectl create` or edited live produces field conflicts; prefer `--server-side` consistently if the repo uses it.
- Forgetting `-n` applies to `default` and leaves orphaned objects.
- Helm `--atomic` without `--timeout` long enough for slow rollouts rolls back a healthy deployment.
- Environment variables referencing other variables (`$(VAR)`) only work for variables defined earlier in the same `env` list.
- Secrets printed via `kubectl get secret -o yaml` end up in logs and chat; redact.
- `hostPath`, `privileged: true`, `hostNetwork: true` are almost never correct for application workloads and will be blocked by Pod Security Admission `restricted`.

## Verification

```bash
kubectl apply --dry-run=server -f k8s/         # schema and admission validation against the real cluster
kubectl diff -k overlays/dev                   # what would change
helm lint charts/api && helm template charts/api -f values-dev.yaml > /dev/null
kubeconform -strict -summary k8s/*.yaml        # offline schema check, if installed
kube-linter lint k8s/                           # best-practice lint, if installed
kubectl rollout status deployment/api -n dev   # rollout completes
kubectl get pods -n dev                        # all Running and READY n/n
```

## References

- Kubernetes API reference: https://kubernetes.io/docs/reference/kubernetes-api/
- Configure probes: https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/
- Resource management: https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/
- Pod Security Standards: https://kubernetes.io/docs/concepts/security/pod-security-standards/
- kubectl cheat sheet: https://kubernetes.io/docs/reference/kubectl/quick-reference/
- Helm docs: https://helm.sh/docs/
- Kustomize reference: https://kubectl.docs.kubernetes.io/references/kustomize/
