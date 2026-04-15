import { DEMO_CONVERSATIONS } from "./fixtures/demo-conversations.js";
const SALES_PIPELINE_AGENTS = [
    {
        name: "Speed-to-Lead Rep",
        slug: "speed-to-lead",
        description: "Responds to inbound leads within 60 seconds. Qualifies through natural conversation.",
        taskCategories: ["lead-qualification"],
        metadata: {
            bundleSlug: "sales-pipeline-bundle",
            roleFocus: "leads",
            family: "sales_pipeline",
            publicChannels: true,
            setupSchema: {
                onboarding: {
                    websiteScan: true,
                    publicChannels: true,
                    privateChannel: false,
                    integrations: [],
                },
                steps: [
                    {
                        id: "basics",
                        title: "Agent Setup",
                        fields: [
                            {
                                key: "tone",
                                type: "select",
                                label: "Conversation Tone",
                                required: true,
                                options: ["friendly", "professional", "casual"],
                            },
                            {
                                key: "customInstructions",
                                type: "textarea",
                                label: "Custom Instructions",
                                required: false,
                            },
                        ],
                    },
                ],
            },
        },
    },
    {
        name: "Sales Closer",
        slug: "sales-closer",
        description: "Takes qualified leads and closes them. Handles objections, builds urgency, confirms decisions.",
        taskCategories: ["sales-closing"],
        metadata: {
            bundleSlug: "sales-pipeline-bundle",
            roleFocus: "growth",
            family: "sales_pipeline",
            publicChannels: true,
            setupSchema: {
                onboarding: {
                    websiteScan: true,
                    publicChannels: true,
                    privateChannel: false,
                    integrations: [],
                },
                steps: [
                    {
                        id: "basics",
                        title: "Agent Setup",
                        fields: [
                            {
                                key: "tone",
                                type: "select",
                                label: "Conversation Tone",
                                required: true,
                                options: ["friendly", "professional", "casual"],
                            },
                            {
                                key: "bookingLink",
                                type: "url",
                                label: "Booking Link",
                                required: true,
                            },
                            {
                                key: "customInstructions",
                                type: "textarea",
                                label: "Custom Instructions",
                                required: false,
                            },
                        ],
                    },
                ],
            },
        },
    },
    {
        name: "Nurture Specialist",
        slug: "nurture-specialist",
        description: "Re-engages cold leads through scheduled follow-ups. Varies approach across cadence.",
        taskCategories: ["lead-nurturing"],
        metadata: {
            bundleSlug: "sales-pipeline-bundle",
            roleFocus: "care",
            family: "sales_pipeline",
            publicChannels: false,
            setupSchema: {
                onboarding: {
                    websiteScan: true,
                    publicChannels: false,
                    privateChannel: false,
                    integrations: [],
                },
                steps: [
                    {
                        id: "basics",
                        title: "Agent Setup",
                        fields: [
                            {
                                key: "tone",
                                type: "select",
                                label: "Conversation Tone",
                                required: true,
                                options: ["friendly", "professional", "casual"],
                            },
                            {
                                key: "customInstructions",
                                type: "textarea",
                                label: "Custom Instructions",
                                required: false,
                            },
                        ],
                    },
                ],
            },
        },
    },
];
const SALES_PIPELINE_BUNDLE = {
    name: "Sales Pipeline Bundle",
    slug: "sales-pipeline-bundle",
    description: "All three sales agents working as one team. Automatic handoffs, shared conversation context.",
    taskCategories: ["lead-qualification", "sales-closing", "lead-nurturing"],
};
const PERFORMANCE_CREATIVE_DIRECTOR = {
    name: "Performance Creative Director",
    slug: "performance-creative-director",
    description: "Full creative pipeline — from trend analysis and hooks to scripts, storyboards, and produced video ads. Stop at any stage.",
    taskCategories: ["creative_strategy", "hooks", "scripts", "storyboard", "production"],
    metadata: {
        isBundle: false,
        family: "paid_media",
        stages: ["trends", "hooks", "scripts", "storyboard", "production"],
        setupSchema: {
            onboarding: {
                websiteScan: true,
                publicChannels: false,
                privateChannel: false,
                integrations: [],
            },
            steps: [
                {
                    id: "basics",
                    title: "Creative Setup",
                    fields: [
                        {
                            key: "targetAudience",
                            type: "textarea",
                            label: "Target Audience",
                            required: false,
                            prefillFrom: "scannedProfile.description",
                        },
                        {
                            key: "platforms",
                            type: "select",
                            label: "Ad Platforms",
                            required: true,
                            options: ["meta", "youtube", "tiktok"],
                        },
                        {
                            key: "brandVoice",
                            type: "textarea",
                            label: "Brand Voice",
                            required: false,
                            prefillFrom: "scannedProfile.brandLanguage",
                        },
                    ],
                },
            ],
        },
    },
};
export async function seedMarketplace(prisma) {
    const agentIds = [];
    for (const agent of SALES_PIPELINE_AGENTS) {
        const listing = await prisma.agentListing.upsert({
            where: { slug: agent.slug },
            update: {
                name: agent.name,
                description: agent.description,
                taskCategories: agent.taskCategories,
                metadata: agent.metadata,
            },
            create: {
                ...agent,
                type: "switchboard_native",
                status: "listed",
                trustScore: 0,
                autonomyLevel: "supervised",
                priceTier: "free",
                priceMonthly: 0,
            },
        });
        agentIds.push(listing.id);
        console.warn(`  Seeded listing: ${agent.name} (${listing.id})`);
    }
    const bundleMetadata = {
        isBundle: true,
        family: "sales_pipeline",
        bundleListingIds: agentIds,
        setupSchema: {
            onboarding: {
                websiteScan: true,
                publicChannels: true,
                privateChannel: false,
                integrations: [],
            },
            steps: [
                {
                    id: "basics",
                    title: "Bundle Setup",
                    fields: [
                        {
                            key: "tone",
                            type: "select",
                            label: "Conversation Tone",
                            required: true,
                            options: ["friendly", "professional", "casual"],
                        },
                        {
                            key: "bookingLink",
                            type: "url",
                            label: "Booking Link",
                            required: true,
                        },
                        {
                            key: "customInstructions",
                            type: "textarea",
                            label: "Custom Instructions",
                            required: false,
                        },
                    ],
                },
            ],
        },
    };
    const bundle = await prisma.agentListing.upsert({
        where: { slug: SALES_PIPELINE_BUNDLE.slug },
        update: {
            name: SALES_PIPELINE_BUNDLE.name,
            description: SALES_PIPELINE_BUNDLE.description,
            metadata: bundleMetadata,
        },
        create: {
            ...SALES_PIPELINE_BUNDLE,
            type: "switchboard_native",
            status: "listed",
            trustScore: 0,
            autonomyLevel: "supervised",
            priceTier: "free",
            priceMonthly: 0,
            metadata: bundleMetadata,
        },
    });
    console.warn(`  Seeded bundle: ${SALES_PIPELINE_BUNDLE.name} (${bundle.id})`);
    // Remove old placeholder that was renamed
    await prisma.agentListing.deleteMany({
        where: { slug: "creative-family" },
    });
    // Remove old trading/finance placeholders that have no backing code
    await prisma.agentListing.deleteMany({
        where: { slug: { in: ["trading-family", "finance-family"] } },
    });
    // Seed Performance Creative Director as a listed agent
    const pcd = await prisma.agentListing.upsert({
        where: { slug: PERFORMANCE_CREATIVE_DIRECTOR.slug },
        update: {
            name: PERFORMANCE_CREATIVE_DIRECTOR.name,
            description: PERFORMANCE_CREATIVE_DIRECTOR.description,
            taskCategories: PERFORMANCE_CREATIVE_DIRECTOR.taskCategories,
            metadata: PERFORMANCE_CREATIVE_DIRECTOR.metadata,
            status: "listed",
        },
        create: {
            ...PERFORMANCE_CREATIVE_DIRECTOR,
            type: "switchboard_native",
            status: "listed",
            trustScore: 0,
            autonomyLevel: "supervised",
            priceTier: "free",
            priceMonthly: 0,
        },
    });
    console.warn(`  Seeded listing: ${PERFORMANCE_CREATIVE_DIRECTOR.name} (${pcd.id})`);
}
/**
 * Seeds demo organization, deployments, tasks, and trust scores for marketplace landing page.
 */
export async function seedDemoData(prisma) {
    const ORG_ID = "org_demo";
    const now = new Date();
    // 1. Create demo organization
    await prisma.organizationConfig.upsert({
        where: { id: ORG_ID },
        update: {
            name: "Austin Bakery Co",
            runtimeType: "http",
            governanceProfile: "guarded",
            onboardingComplete: true,
            provisioningStatus: "active",
        },
        create: {
            id: ORG_ID,
            name: "Austin Bakery Co",
            runtimeType: "http",
            governanceProfile: "guarded",
            onboardingComplete: true,
            provisioningStatus: "active",
        },
    });
    console.warn(`  Created demo org: ${ORG_ID}`);
    // 2. Get all sales pipeline agent listings
    const listings = await prisma.agentListing.findMany({
        where: {
            slug: { in: ["speed-to-lead", "sales-closer", "nurture-specialist"] },
        },
    });
    const listingMap = new Map(listings.map((l) => [l.slug, l]));
    // 3. Create deployments for all 3 agents
    const deployments = [];
    for (const agent of SALES_PIPELINE_AGENTS) {
        const listing = listingMap.get(agent.slug);
        if (!listing) {
            console.warn(`  WARNING: Listing not found for ${agent.slug}`);
            continue;
        }
        const deployment = await prisma.agentDeployment.upsert({
            where: {
                organizationId_listingId: {
                    organizationId: ORG_ID,
                    listingId: listing.id,
                },
            },
            update: {
                status: "active",
                inputConfig: {},
                governanceSettings: {},
                connectionIds: [],
            },
            create: {
                organizationId: ORG_ID,
                listingId: listing.id,
                status: "active",
                inputConfig: {},
                governanceSettings: {},
                connectionIds: [],
            },
        });
        deployments.push({ slug: agent.slug, id: deployment.id, listingId: listing.id });
        console.warn(`  Created deployment: ${agent.name} (${deployment.id})`);
    }
    const deploymentMap = new Map(deployments.map((d) => [d.slug, d]));
    // 4. Delete existing demo tasks for clean re-seed
    const deleteResult = await prisma.agentTask.deleteMany({
        where: { organizationId: ORG_ID },
    });
    console.warn(`  Deleted ${deleteResult.count} existing demo tasks`);
    const trustScores = new Map();
    function getTrustKey(listingId, category) {
        return `${listingId}:${category}`;
    }
    function getOrInitTrust(listingId, category) {
        const key = getTrustKey(listingId, category);
        if (!trustScores.has(key)) {
            trustScores.set(key, {
                score: 0,
                totalApprovals: 0,
                totalRejections: 0,
                consecutiveApprovals: 0,
            });
        }
        return trustScores.get(key);
    }
    function updateTrust(listingId, category, approved) {
        const state = getOrInitTrust(listingId, category);
        if (approved) {
            state.totalApprovals += 1;
            state.consecutiveApprovals += 1;
            // Base +3, streak bonus up to +2 (0.5 per consecutive, capped)
            const streakBonus = Math.min(state.consecutiveApprovals * 0.5, 2);
            state.score += 3 + streakBonus;
        }
        else {
            state.totalRejections += 1;
            state.consecutiveApprovals = 0;
            state.score -= 10;
        }
        // Clamp to 0-100
        state.score = Math.max(0, Math.min(100, state.score));
    }
    // 6. Create tasks from DEMO_CONVERSATIONS
    let taskCount = 0;
    for (const conv of DEMO_CONVERSATIONS) {
        const deployment = deploymentMap.get(conv.agentSlug);
        if (!deployment) {
            console.warn(`  WARNING: Deployment not found for ${conv.agentSlug}`);
            continue;
        }
        // Calculate timestamps relative to now
        const createdAt = new Date(now.getTime() - conv.minutesAgo * 60 * 1000);
        const lastMessageOffset = Math.max(...conv.messages.map((m) => m.minutesOffset));
        const completedAt = new Date(createdAt.getTime() + lastMessageOffset * 60 * 1000);
        // Build output JSON with absolute timestamps
        const messagesWithTimestamps = conv.messages.map((msg) => ({
            role: msg.role,
            text: msg.text,
            timestamp: new Date(createdAt.getTime() + msg.minutesOffset * 60 * 1000).toISOString(),
        }));
        const output = {
            summary: conv.summary,
            outcome: conv.outcome,
            handoffTo: conv.handoffTo,
            messages: messagesWithTimestamps,
        };
        // Determine status based on reviewStatus
        const status = conv.reviewStatus;
        await prisma.agentTask.create({
            data: {
                deploymentId: deployment.id,
                organizationId: ORG_ID,
                listingId: deployment.listingId,
                category: conv.category,
                status,
                input: {},
                output,
                reviewResult: conv.reviewStatus === "approved" ? "approved" : "rejected",
                reviewedBy: "principal_dev",
                reviewedAt: completedAt,
                completedAt,
                createdAt,
            },
        });
        // Update trust score state
        updateTrust(deployment.listingId, conv.category, conv.reviewStatus === "approved");
        taskCount += 1;
    }
    console.warn(`  Created ${taskCount} demo tasks from fixtures`);
    // 7. Create/update TrustScoreRecord entries
    for (const [key, state] of trustScores.entries()) {
        const parts = key.split(":");
        const listingId = parts[0];
        const category = parts[1];
        if (!listingId || !category) {
            console.warn(`  WARNING: Invalid trust key: ${key}`);
            continue;
        }
        await prisma.trustScoreRecord.upsert({
            where: {
                listingId_taskCategory: {
                    listingId,
                    taskCategory: category,
                },
            },
            update: {
                score: state.score,
                totalApprovals: state.totalApprovals,
                totalRejections: state.totalRejections,
                consecutiveApprovals: state.consecutiveApprovals,
                lastActivityAt: now,
            },
            create: {
                listingId,
                taskCategory: category,
                score: state.score,
                totalApprovals: state.totalApprovals,
                totalRejections: state.totalRejections,
                consecutiveApprovals: state.consecutiveApprovals,
                lastActivityAt: now,
            },
        });
    }
    console.warn(`  Created/updated ${trustScores.size} trust score records`);
    // 8. Update listing trustScore and autonomyLevel based on aggregate scores
    for (const deployment of deployments) {
        const listing = listingMap.get(deployment.slug);
        if (!listing)
            continue;
        // Get all trust score records for this listing
        const records = await prisma.trustScoreRecord.findMany({
            where: { listingId: deployment.listingId },
        });
        if (records.length === 0)
            continue;
        // Calculate aggregate trust score (average across categories)
        const avgScore = records.reduce((sum, r) => sum + r.score, 0) / records.length;
        // Determine autonomy level
        let autonomyLevel = "supervised";
        if (avgScore >= 80) {
            autonomyLevel = "autonomous";
        }
        else if (avgScore >= 55) {
            autonomyLevel = "autonomous";
        }
        else if (avgScore >= 30) {
            autonomyLevel = "guided";
        }
        // Determine price tier
        let priceTier = "free";
        let priceMonthly = 0;
        if (avgScore >= 80) {
            priceTier = "elite";
            priceMonthly = 299;
        }
        else if (avgScore >= 55) {
            priceTier = "pro";
            priceMonthly = 149;
        }
        else if (avgScore >= 30) {
            priceTier = "basic";
            priceMonthly = 49;
        }
        await prisma.agentListing.update({
            where: { id: deployment.listingId },
            data: {
                trustScore: avgScore,
                autonomyLevel,
                priceTier,
                priceMonthly,
            },
        });
        console.warn(`  Updated listing ${deployment.slug}: trustScore=${avgScore.toFixed(1)}, autonomy=${autonomyLevel}, tier=${priceTier}`);
    }
}
//# sourceMappingURL=seed-marketplace.js.map