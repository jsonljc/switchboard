// ---------------------------------------------------------------------------
// Meta Studies Client — Meta Ad Studies API integration
// ---------------------------------------------------------------------------

export interface AdStudy {
  id: string;
  name: string;
  status: string;
  startTime: string | null;
  endTime: string | null;
  results: Record<string, unknown> | null;
  cells: Array<{
    id: string;
    name: string;
    treatmentPercentage: number;
  }>;
}

export interface CreateStudyParams {
  adAccountId: string;
  name: string;
  description?: string;
  startTime?: string;
  endTime?: string;
  type?: string;
  cells: Array<{
    name: string;
    treatmentPercentage: number;
    adSets: string[];
  }>;
}

export class MetaStudiesClient {
  constructor(
    private readonly baseUrl: string,
    private readonly accessToken: string,
  ) {}

  async create(params: CreateStudyParams): Promise<AdStudy> {
    const accountId = params.adAccountId.startsWith("act_")
      ? params.adAccountId
      : `act_${params.adAccountId}`;

    const url = `${this.baseUrl}/${accountId}/ad_studies?access_token=${this.accessToken}`;
    const body = {
      name: params.name,
      description: params.description ?? "",
      type: params.type ?? "SPLIT_TEST",
      start_time: params.startTime,
      end_time: params.endTime,
      cells: params.cells.map((cell) => ({
        name: cell.name,
        treatment_percentage: cell.treatmentPercentage,
        adsets: cell.adSets,
      })),
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const error = errorBody.error as Record<string, unknown> | undefined;
      throw new Error(
        `Failed to create ad study: ${(error?.message as string) ?? `HTTP ${response.status}`}`,
      );
    }

    const data = (await response.json()) as Record<string, unknown>;

    return {
      id: String(data.id),
      name: params.name,
      status: "DRAFT",
      startTime: params.startTime ?? null,
      endTime: params.endTime ?? null,
      results: null,
      cells: params.cells.map((cell, i) => ({
        id: `cell_${i}`,
        name: cell.name,
        treatmentPercentage: cell.treatmentPercentage,
      })),
    };
  }

  async get(studyId: string): Promise<AdStudy> {
    const url =
      `${this.baseUrl}/${studyId}?fields=` +
      "id,name,status,start_time,end_time,results,cells{id,name,treatment_percentage}" +
      `&access_token=${this.accessToken}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ad study ${studyId}`);
    }

    const data = (await response.json()) as Record<string, unknown>;
    const cells = data.cells as { data?: Array<Record<string, unknown>> } | undefined;

    return {
      id: String(data.id),
      name: String(data.name ?? ""),
      status: String(data.status ?? ""),
      startTime: (data.start_time as string) ?? null,
      endTime: (data.end_time as string) ?? null,
      results: (data.results as Record<string, unknown>) ?? null,
      cells: (cells?.data ?? []).map((c) => ({
        id: String(c.id),
        name: String(c.name ?? ""),
        treatmentPercentage: Number(c.treatment_percentage ?? 0),
      })),
    };
  }

  async list(adAccountId: string): Promise<AdStudy[]> {
    const accountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
    const url =
      `${this.baseUrl}/${accountId}/ad_studies?fields=` +
      "id,name,status,start_time,end_time" +
      `&access_token=${this.accessToken}`;

    const results: AdStudy[] = [];
    let nextUrl: string | null = url;

    while (nextUrl) {
      const response = await fetch(nextUrl);
      if (!response.ok) break;
      const data = (await response.json()) as Record<string, unknown>;
      const studies = (data.data ?? []) as Record<string, unknown>[];

      for (const study of studies) {
        results.push({
          id: String(study.id),
          name: String(study.name ?? ""),
          status: String(study.status ?? ""),
          startTime: (study.start_time as string) ?? null,
          endTime: (study.end_time as string) ?? null,
          results: null,
          cells: [],
        });
      }

      nextUrl = ((data.paging as Record<string, unknown> | undefined)?.next as string) ?? null;
    }

    return results;
  }
}
