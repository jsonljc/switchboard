---
name: Native Runtime Architecture
description: Native session/workflow runtime replacing OpenClaw — ConversationThread, WorkflowEngine, SchedulerService, OperatorChat
type: project
---

Native runtime with three session types (ConversationThread, WorkflowExecution, OperatorCommand), 9-state workflow state machine, rolling WorkflowPlan, and BullMQ scheduler. All phases complete (PRs #158, #159).

Key paths: sessions in `packages/core/src/sessions/`, workflows in `packages/core/src/workflows/`, scheduler in `packages/core/src/scheduler/`, operator in `packages/agents/src/operator/`.
