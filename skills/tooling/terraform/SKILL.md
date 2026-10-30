---
name: terraform
description: Write, review and apply Terraform and OpenTofu 1.x infrastructure code. Covers module structure, state and remote backends, variables and outputs, providers and lock files, the init/fmt/validate/plan/apply loop with plan review, workspaces versus directories, and linting with tflint, tfsec/trivy and checkov. Use when editing .tf or .tfvars files or a project with main.tf, .terraform.lock.hcl or terraform.tfstate.
---

# Terraform / OpenTofu

Assumes Terraform 1.5+ or OpenTofu 1.6+. Commands are shown as `terraform`; substitute `tofu` when the repo uses OpenTofu (check `.opentofu-version`, `.tool-versions`, CI, or `required_version`).

## When to use

- Creating or editing `.tf`, `.tfvars`, `.tftest.hcl` files or modules.
- Planning, applying, importing or refactoring infrastructure; fixing state problems.
- Reviewing infrastructure changes for safety and blast radius.

## Project conventions to detect first

1. Tool and version: `required_version` in `terraform {}` blocks, `.terraform-version` (tfenv), `.tool-versions` (asdf/mise), CI pipeline. Do not upgrade versions as a side effect.
2. Layout: single root, `environments/<env>/` directories, `modules/` folder, Terragrunt (`terragrunt.hcl`), or a monorepo of stacks. Match it.
3. Backend: `backend "s3"`, `"gcs"`, `"azurerm"`, `"remote"`/HCP Terraform, or local. Local state in a shared repo is a red flag; mention it, do not silently change it.
4. Environment separation: directories with their own backend keys vs `terraform workspace`. Follow what exists.
5. Variables: `*.auto.tfvars`, `terraform.tfvars`, `-var-file` in Makefile/CI, `TF_VAR_*` env vars. Secrets should come from env or a secret manager, not committed tfvars.
6. Lint/security config: `.tflint.hcl`, `.checkov.yaml`, `trivy`/`tfsec` config, pre-commit hooks (`.pre-commit-config.yaml` with `terraform_fmt`, `terraform_docs`).
7. Provider pinning: `required_providers` with `~>` constraints and a committed `.terraform.lock.hcl`.

## Core guidance

### Safety rules

- Never run `terraform apply` without first running `terraform plan -out=tfplan` and showing the plan summary (resources to add/change/destroy) to the user. Apply the saved plan file: `terraform apply tfplan`.
- Never run `terraform destroy`, `terraform state rm`, `terraform state mv`, `terraform taint`, or `terraform apply -replace=...` on shared/production state without explicit confirmation naming the resource.
- Treat any plan with `destroy` or `replace` lines as high risk; explain why each resource is being destroyed (usually an immutable attribute change) before proceeding.
- Never use `-auto-approve` in interactive sessions. In CI it is acceptable only on a plan file that was reviewed.
- Never commit `terraform.tfstate`, `*.tfstate.backup`, `.terraform/`, or `*.tfvars` containing secrets. Ensure `.gitignore` covers them.
- Do not edit state files by hand.

### File and module layout

```
main.tf            # resources and module calls
variables.tf       # input variables with type, description, validation
outputs.tf         # outputs with description
versions.tf        # terraform { required_version, required_providers }
providers.tf       # provider configuration (root modules only)
locals.tf          # optional
modules/<name>/    # reusable modules: main.tf, variables.tf, outputs.tf, README.md
environments/<env>/  # root modules per environment (backend + tfvars)
```

- Root modules configure providers and backends; child modules never configure providers (they receive them implicitly or via `providers = {}`).
- Keep modules small and purposeful; expose few inputs with sane defaults; output IDs/ARNs consumers need.
- Pin module sources: registry `version = "~> 5.0"`, git `?ref=v1.2.0` (tag or SHA), never a branch.

### Variables and outputs

```hcl
variable "instance_type" {
  type        = string
  description = "EC2 instance type for the API nodes."
  default     = "t3.small"
  validation {
    condition     = can(regex("^t3\\.", var.instance_type))
    error_message = "Only t3 instance types are allowed."
  }
}

variable "db_password" {
  type      = string
  sensitive = true
}

output "api_url" {
  description = "Public URL of the API load balancer."
  value       = "https://${aws_lb.api.dns_name}"
}
```

- Always set `type` and `description`. Use `object({...})` with `optional()` attributes for structured inputs.
- Mark secrets `sensitive = true`; they are still stored in state in plaintext, so protect the backend (encryption, access control).
- Use `locals` for derived values and naming; avoid repeating string interpolation.

### Resources

- Use `for_each` with a map or set of strings over `count` for collections; `count` only for on/off (`count = var.enabled ? 1 : 0`). Changing a `count` list reorders and recreates resources.
- Use `lifecycle { prevent_destroy = true }` on stateful resources (databases, buckets, KMS keys) and `ignore_changes` for attributes managed outside Terraform.
- Prefer `moved {}` blocks when renaming resources or moving them into modules, instead of `terraform state mv`.
- Use `import {}` blocks (1.5+) with `terraform plan -generate-config-out=generated.tf` to adopt existing infrastructure.
- Reference attributes rather than hardcoding IDs; use `data` sources for things created elsewhere.
- Tag/label everything via `default_tags` on the provider where supported.

### Providers and lock file

```hcl
terraform {
  required_version = "~> 1.9"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.60" }
  }
  backend "s3" {
    bucket         = "org-tfstate"
    key            = "prod/network.tfstate"
    region         = "eu-west-1"
    dynamodb_table = "tfstate-lock"   # or use_lockfile = true on AWS provider/Terraform 1.10+
    encrypt        = true
  }
}
```

- Commit `.terraform.lock.hcl`. Update with `terraform init -upgrade` deliberately; for multi-platform teams run `terraform providers lock -platform=linux_amd64 -platform=darwin_arm64`.
- Backend config cannot use variables; use `-backend-config=` files or partial configuration per environment.

### Workspaces vs directories

- Directories per environment (separate backends/state) are safer and clearer; CLI workspaces share backend config and are easy to apply to the wrong one. Use workspaces only if the repo already does, and print `terraform workspace show` before any plan/apply.

## Common tasks

### Standard change loop

```bash
terraform fmt -recursive
terraform init              # or init -upgrade when bumping providers; -reconfigure for backend changes
terraform validate
terraform plan -out=tfplan -var-file=environments/dev.tfvars
terraform show tfplan       # review; summarize adds/changes/destroys for the user
terraform apply tfplan      # only after review/confirmation
```

In CI, prefer `terraform plan -detailed-exitcode` (exit 2 = changes present) and post the plan on the PR.

### Add a resource

1. Put it in the module that owns that domain; add variables/outputs as needed.
2. `terraform validate` then `plan`; confirm only the expected resource is added.
3. Add tags, `prevent_destroy` for stateful resources, and `depends_on` only when implicit references are impossible.

### Refactor into a module

1. Create `modules/<name>/` with `main.tf`, `variables.tf`, `outputs.tf`.
2. Replace the resources in the root with a `module "<name>" {}` call.
3. Add `moved { from = aws_s3_bucket.logs  to = module.logs.aws_s3_bucket.this }` blocks for each resource.
4. `terraform plan` must show no changes (only moves). If it shows destroy/create, fix the `moved` addresses before applying.

### Import existing infrastructure

```hcl
import {
  to = aws_s3_bucket.logs
  id = "org-logs-prod"
}
```

`terraform plan -generate-config-out=generated.tf`, review and tidy the generated block, then `plan` again until it shows no diff, then `apply`.

### Unlock stuck state

Only after confirming no other run is active: `terraform force-unlock <LOCK_ID>`. Ask the user first.

### Write a test (1.6+)

```hcl
# tests/basic.tftest.hcl
run "creates_bucket" {
  command = plan
  variables { name = "test-bucket" }
  assert {
    condition     = aws_s3_bucket.this.bucket == "test-bucket"
    error_message = "bucket name mismatch"
  }
}
```

Run with `terraform test`.

## Pitfalls

- Applying from a laptop against a backend also used by CI causes lock contention and drift; prefer CI applies.
- `count` indexed by list position recreates everything when an item is removed from the middle; use `for_each`.
- Changing an immutable attribute (name, AZ, engine) forces replacement; the plan says `# forces replacement`. Read it.
- `terraform init -upgrade` silently bumps providers and can change behaviour; do it in a dedicated change.
- Provider blocks inside child modules break `for_each`/`count` on the module and prevent removal.
- `depends_on` on modules forces all resources inside to wait and re-plan; use attribute references instead.
- Unpinned module `source = "git::...//modules/x"` without `?ref=` pulls the default branch.
- Secrets passed as variables are stored in state; use `ephemeral` variables/resources (1.10+) or a secret manager data source when available.
- Running `plan` with the wrong `-var-file` or workspace shows a huge destroy diff; always echo the environment before planning.
- `terraform.tfvars` is auto-loaded; `dev.tfvars` is not unless named `*.auto.tfvars` or passed with `-var-file`.

## Verification

```bash
terraform fmt -check -recursive
terraform validate
tflint --recursive                     # https://github.com/terraform-linters/tflint
trivy config .  # or: tfsec .          # misconfiguration scan
checkov -d .                           # policy scan, if the repo uses it
terraform plan -out=tfplan             # review; no unexpected destroys
terraform test                         # if tests/ exists
terraform-docs markdown modules/<name> # keep module README in sync, if used
```

## References

- Terraform language docs: https://developer.hashicorp.com/terraform/language
- CLI commands: https://developer.hashicorp.com/terraform/cli/commands
- Style guide: https://developer.hashicorp.com/terraform/language/style
- Module development: https://developer.hashicorp.com/terraform/language/modules/develop
- OpenTofu docs: https://opentofu.org/docs/
- tflint: https://github.com/terraform-linters/tflint
- Trivy misconfiguration scanning: https://aquasecurity.github.io/trivy/latest/docs/scanner/misconfiguration/
- Checkov: https://www.checkov.io/
