import type { PrismaClient } from "@prisma/client";

// Non-production demo assets — short hosted sample clips so the local feed
// renders. Swap for real Mira output before any non-dev use.
const SAMPLE_POLISHED =
  "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4";
const SAMPLE_UGC = "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4";
const SAMPLE_KEPT = "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4";
const SAMPLE_KEPT_THUMB =
  "https://storage.googleapis.com/gtv-videos-bucket/sample/images/ForBiggerBlazes.jpg";

/**
 * Seeds two demo creative drafts (one polished, one UGC) for `orgId` so the
 * Mira review feed has something to show locally. Idempotent on fixed ids.
 * Reuses an existing AgentDeployment for the org (creating deployments/listings
 * is out of scope — if none exists, logs and skips: dev convenience only).
 */
export async function seedMiraDemoCreatives(prisma: PrismaClient, orgId: string): Promise<void> {
  if (process.env["NODE_ENV"] === "production") {
    console.warn("seedMiraDemoCreatives: NODE_ENV=production — skipping demo creatives.");
    return;
  }
  const deployment = await prisma.agentDeployment.findFirst({ where: { organizationId: orgId } });
  if (!deployment) {
    console.warn(`seedMiraDemoCreatives: no deployment for ${orgId} — skipping demo creatives.`);
    return;
  }

  const drafts = [
    {
      id: "dev_mira_demo_polished",
      taskId: "dev_mira_demo_task_polished",
      mode: "polished",
      currentStage: "complete",
      stageOutputs: {
        production: { assembledVideos: [{ videoUrl: SAMPLE_POLISHED, duration: 15 }] },
      },
      ugcPhase: null as string | null,
      ugcPhaseOutputs: null as unknown,
      productDescription: "Spring glow facial — limited promo",
      reviewDecision: null as string | null,
      reviewDecidedAt: null as Date | null,
    },
    {
      id: "dev_mira_demo_ugc",
      taskId: "dev_mira_demo_task_ugc",
      mode: "ugc",
      currentStage: "trends",
      stageOutputs: {},
      ugcPhase: "complete",
      ugcPhaseOutputs: { production: { assets: [{ outputs: { videoUrl: SAMPLE_UGC } }] } },
      productDescription: "UGC testimonial — first-visit offer",
      reviewDecision: null as string | null,
      reviewDecidedAt: null as Date | null,
    },
    {
      id: "dev_mira_demo_kept",
      taskId: "dev_mira_demo_task_kept",
      mode: "polished",
      currentStage: "complete",
      stageOutputs: {
        production: {
          assembledVideos: [
            { videoUrl: SAMPLE_KEPT, thumbnailUrl: SAMPLE_KEPT_THUMB, duration: 20 },
          ],
        },
      },
      ugcPhase: null as string | null,
      ugcPhaseOutputs: null as unknown,
      productDescription: "Hydration reset treatment — book before the end of the month",
      reviewDecision: "kept" as string | null,
      reviewDecidedAt: new Date("2026-05-30T10:00:00Z") as Date | null,
    },
  ];

  for (const d of drafts) {
    await prisma.agentTask.upsert({
      where: { id: d.taskId },
      update: {},
      create: {
        id: d.taskId,
        deploymentId: deployment.id,
        organizationId: orgId,
        listingId: deployment.listingId,
        category: "creative",
        status: "awaiting_review",
        input: {},
      },
    });
    await prisma.creativeJob.upsert({
      where: { id: d.id },
      update: {
        currentStage: d.currentStage,
        stageOutputs: d.stageOutputs,
        ugcPhase: d.ugcPhase,
        ugcPhaseOutputs: d.ugcPhaseOutputs as object,
        reviewDecision: d.reviewDecision,
        reviewDecidedAt: d.reviewDecidedAt,
      },
      create: {
        id: d.id,
        taskId: d.taskId,
        organizationId: orgId,
        deploymentId: deployment.id,
        productDescription: d.productDescription,
        targetAudience: "local prospects",
        platforms: ["meta"],
        mode: d.mode,
        currentStage: d.currentStage,
        stageOutputs: d.stageOutputs,
        ugcPhase: d.ugcPhase,
        ugcPhaseOutputs: d.ugcPhaseOutputs as object,
        reviewDecision: d.reviewDecision,
        reviewDecidedAt: d.reviewDecidedAt,
      },
    });
  }
  console.warn(`seedMiraDemoCreatives: seeded 3 demo drafts for ${orgId}`);
}
