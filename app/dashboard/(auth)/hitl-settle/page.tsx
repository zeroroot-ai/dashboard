// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { HitlSettleQueueContent } from '@/components/gibson/hitl-settle/HitlSettleQueueContent';
import { ProofReviewsContent } from '@/components/gibson/hitl-settle/ProofReviewsContent';

export default function HitlSettleQueuePage() {
  return (
    <div className="space-y-10">
      <HitlSettleQueueContent />
      <ProofReviewsContent />
    </div>
  );
}
