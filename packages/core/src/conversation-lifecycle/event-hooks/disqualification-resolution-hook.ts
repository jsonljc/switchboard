import type {
  DisqualificationResolver,
  ConfirmResult,
  DismissResult,
  ResolveInput,
} from "../qualification/disqualification-resolver.js";
import type { LifecycleConfigResolver } from "../lifecycle-config-resolver.js";

export interface DisqualificationResolutionHookDeps {
  resolver: Pick<DisqualificationResolver, "confirm" | "dismiss">;
  configResolver: Pick<LifecycleConfigResolver, "resolveCapabilities">;
}

export type HookConfirmResult = ConfirmResult | { result: "capability_disabled" };
export type HookDismissResult = DismissResult | { result: "capability_disabled" };

export class DisqualificationResolutionHook {
  constructor(private readonly deps: DisqualificationResolutionHookDeps) {}

  async confirm(input: ResolveInput): Promise<HookConfirmResult> {
    const caps = await this.deps.configResolver.resolveCapabilities(input.organizationId);
    if (!caps.has("qualification")) return { result: "capability_disabled" };
    return this.deps.resolver.confirm(input);
  }

  async dismiss(input: ResolveInput): Promise<HookDismissResult> {
    const caps = await this.deps.configResolver.resolveCapabilities(input.organizationId);
    if (!caps.has("qualification")) return { result: "capability_disabled" };
    return this.deps.resolver.dismiss(input);
  }
}
