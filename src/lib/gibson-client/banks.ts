import 'server-only';

/**
 * Typed dashboard client for gibson.bank.v1.BankService (gibson#1706, lane E1).
 *
 * Every call runs through `userClient`, so it flows dashboard -> Envoy (JWT +
 * SPIFFE mTLS) + ext-authz -> daemon. The bank RPCs name their object in the
 * request, so the dashboard's registry gate forwards them after the tenant
 * floor and the daemon decides the grant (dashboard#1176). A bank the caller
 * may not read comes back NOT_FOUND, never as data.
 *
 * This module maps protos to the client-safe views in `src/lib/banks/view.ts`
 * so no client component imports a binding.
 */

import { create } from '@bufbuild/protobuf';
import { DurationSchema, timestampDate, type Duration, type Timestamp } from '@bufbuild/protobuf/wkt';
import {
  BankService,
  LoginShape,
  MemberState,
  SpillPolicy,
  type Bank,
  type Member,
} from '@/src/gen/gibson/bank/v1/bank_pb';
import { Principal_Kind, type Principal } from '@/src/gen/gibson/common/v1/gibson_common_pb';
import { userClient } from '../gibson-client';
import type {
  BankView,
  LoginShapeName,
  MemberStateName,
  MemberView,
  PrincipalView,
  SignInStepView,
  SpillPolicyName,
} from '../banks/view';

// ---------------------------------------------------------------------------
// Enum names
// ---------------------------------------------------------------------------

const LOGIN_SHAPE_NAME: Readonly<Record<LoginShapeName, LoginShape>> = {
  subscription: LoginShape.SUBSCRIPTION,
  anthropic_api_key: LoginShape.ANTHROPIC_API_KEY,
  bedrock: LoginShape.BEDROCK,
  vertex: LoginShape.VERTEX,
  foundry: LoginShape.FOUNDRY,
};

const SPILL_POLICY_NAME: Readonly<Record<SpillPolicyName, SpillPolicy>> = {
  queue: SpillPolicy.QUEUE,
  ephemeral: SpillPolicy.EPHEMERAL,
};

function loginShapeName(v: LoginShape): LoginShapeName {
  for (const [name, value] of Object.entries(LOGIN_SHAPE_NAME)) {
    if (value === v) return name as LoginShapeName;
  }
  // The daemon refuses an unspecified shape on create, so a stored bank
  // always carries one. Fall back to the safest reading for display.
  return 'anthropic_api_key';
}

function spillPolicyName(v: SpillPolicy): SpillPolicyName {
  return v === SpillPolicy.EPHEMERAL ? 'ephemeral' : 'queue';
}

function memberStateName(v: MemberState): MemberStateName {
  switch (v) {
    case MemberState.LAUNCHING:
      return 'launching';
    case MemberState.NEEDS_SIGN_IN:
      return 'needs_sign_in';
    case MemberState.IDLE:
      return 'idle';
    case MemberState.BUSY:
      return 'busy';
    case MemberState.DRAINING:
      return 'draining';
    case MemberState.DEAD:
      return 'dead';
    default:
      return 'unknown';
  }
}

function principalView(p: Principal | undefined): PrincipalView {
  if (!p) return { kind: 'unknown', id: '' };
  switch (p.kind) {
    case Principal_Kind.USER:
      return { kind: 'user', id: p.id };
    case Principal_Kind.TENANT:
      return { kind: 'tenant', id: p.id };
    case Principal_Kind.COMPONENT:
      return { kind: 'component', id: p.id };
    case Principal_Kind.SERVICE:
      return { kind: 'service', id: p.id };
    default:
      return { kind: 'unknown', id: p.id };
  }
}

function iso(ts: Timestamp | undefined): string | null {
  return ts ? timestampDate(ts).toISOString() : null;
}

function seconds(d: Duration | undefined): number | null {
  return d ? Number(d.seconds) : null;
}

function duration(secs: number): Duration {
  return create(DurationSchema, { seconds: BigInt(secs), nanos: 0 });
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

function toBankView(b: Bank): BankView {
  return {
    id: b.id,
    tenantId: b.tenantId,
    owner: principalView(b.owner),
    name: b.name,
    desiredCount: b.desiredCount,
    loginShape: loginShapeName(b.loginShape),
    providerConfigName: b.providerConfigName,
    agentName: b.agentName,
    model: b.model,
    maxJobsInFlight: b.maxJobsInFlight,
    staleLimitSeconds: seconds(b.staleLimit),
    spillPolicy: spillPolicyName(b.spillPolicy),
    createdAt: iso(b.createdAt),
    updatedAt: iso(b.updatedAt),
  };
}

function toMemberView(m: Member): MemberView {
  return {
    id: m.id,
    bankId: m.bankId,
    missionId: m.missionId,
    missionRunId: m.missionRunId,
    agentRunId: m.agentRunId,
    sandboxId: m.sandboxId,
    state: memberStateName(m.status?.state ?? MemberState.UNSPECIFIED),
    jobsInFlight: m.status?.jobsInFlight ?? 0,
    cap: m.status?.cap ?? 0,
    activeJobIds: [...(m.status?.activeJobIds ?? [])],
    claudeVersion: m.status?.claudeVersion ?? '',
    lastHeartbeat: iso(m.lastHeartbeat),
  };
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

interface CreateBankInput {
  name: string;
  tenantOwned: boolean;
  desiredCount: number;
  loginShape: LoginShapeName;
  providerConfigName: string;
  agentName: string;
  model: string;
  maxJobsInFlight: number;
  /** Zero or absent means the daemon default. */
  staleLimitSeconds?: number;
  spillPolicy?: SpillPolicyName;
}

interface UpdateBankInput {
  desiredCount?: number;
  maxJobsInFlight?: number;
  staleLimitSeconds?: number;
  spillPolicy?: SpillPolicyName;
}

interface BankPage {
  banks: BankView[];
  nextPageToken: string;
}

interface MemberPage {
  members: MemberView[];
  nextPageToken: string;
}

const PAGE_SIZE = 200;

export async function listBanks(pageToken = ''): Promise<BankPage> {
  const resp = await userClient(BankService).listBanks({ pageSize: PAGE_SIZE, pageToken });
  return { banks: resp.banks.map(toBankView), nextPageToken: resp.nextPageToken };
}

export async function getBank(id: string): Promise<BankView | null> {
  const resp = await userClient(BankService).getBank({ id });
  return resp.bank ? toBankView(resp.bank) : null;
}

export async function createBank(input: CreateBankInput): Promise<BankView | null> {
  const resp = await userClient(BankService).createBank({
    name: input.name,
    tenantOwned: input.tenantOwned,
    desiredCount: input.desiredCount,
    loginShape: LOGIN_SHAPE_NAME[input.loginShape],
    providerConfigName: input.providerConfigName,
    agentName: input.agentName,
    model: input.model,
    maxJobsInFlight: input.maxJobsInFlight,
    staleLimit: input.staleLimitSeconds && input.staleLimitSeconds > 0 ? duration(input.staleLimitSeconds) : undefined,
    spillPolicy: input.spillPolicy ? SPILL_POLICY_NAME[input.spillPolicy] : SpillPolicy.UNSPECIFIED,
  });
  return resp.bank ? toBankView(resp.bank) : null;
}

export async function updateBank(id: string, input: UpdateBankInput): Promise<BankView | null> {
  const resp = await userClient(BankService).updateBank({
    id,
    desiredCount: input.desiredCount,
    maxJobsInFlight: input.maxJobsInFlight,
    staleLimit: input.staleLimitSeconds !== undefined && input.staleLimitSeconds > 0 ? duration(input.staleLimitSeconds) : undefined,
    spillPolicy: input.spillPolicy ? SPILL_POLICY_NAME[input.spillPolicy] : undefined,
  });
  return resp.bank ? toBankView(resp.bank) : null;
}

export async function deleteBank(id: string): Promise<void> {
  await userClient(BankService).deleteBank({ id });
}

export async function listMembers(bankId: string, pageToken = ''): Promise<MemberPage> {
  const resp = await userClient(BankService).listMembers({ bankId, pageSize: PAGE_SIZE, pageToken });
  return { members: resp.members.map(toMemberView), nextPageToken: resp.nextPageToken };
}

// ---------------------------------------------------------------------------
// The sign-in relay (gibson#1706 lane E2, epic decision 8)
//
// A subscription bank signs in inside its sandbox through Anthropic's own
// flow. The daemon relays the URL and the code prompt; the person opens the
// URL on claude.ai and pastes the code back. The platform never sees the
// token. Only the bank owner may drive it: every RPC here is `owner` on the
// bank, which the daemon decides.
// ---------------------------------------------------------------------------

export async function startSignIn(bankId: string, memberId: string): Promise<MemberView | null> {
  const resp = await userClient(BankService).startSignIn({ bankId, memberId });
  return resp.member ? toMemberView(resp.member) : null;
}

export async function submitSignInCode(bankId: string, memberId: string, code: string): Promise<MemberView | null> {
  const resp = await userClient(BankService).submitSignInCode({ bankId, memberId, code });
  return resp.member ? toMemberView(resp.member) : null;
}

/** Follows one member's sign-in flow until done or error, or until `signal` aborts. */
export async function* streamSignIn(bankId: string, memberId: string, signal: AbortSignal): AsyncIterable<SignInStepView> {
  for await (const step of userClient(BankService).streamSignIn({ bankId, memberId }, { signal })) {
    yield { url: step.url, codePrompt: step.codePrompt, done: step.done, error: step.error };
  }
}
