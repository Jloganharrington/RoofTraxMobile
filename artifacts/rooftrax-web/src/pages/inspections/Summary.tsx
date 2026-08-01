import { useState, useRef, useEffect } from "react";
import { useParams, Link } from "wouter";
import { 
  useGetInspection, 
  useGetInspectionSummary, 
  useGenerateInspectionSummary, 
  useUpdateInspectionSummary,
  getGetInspectionSummaryQueryKey,
  getGetInspectionQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Shell } from "@/components/layout/Shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, AlertTriangle, Sparkles, ArrowLeft, CheckCircle2, Info, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Summary() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: inspectionEnv, isLoading: isInspectionLoading } = useGetInspection(id, { query: { enabled: !!id, queryKey: getGetInspectionQueryKey(id) } });
  const { data: summaryEnv, isLoading: isSummaryLoading } = useGetInspectionSummary(id, { query: { enabled: !!id, queryKey: getGetInspectionSummaryQueryKey(id) } });
  
  const generateSummary = useGenerateInspectionSummary();
  const updateSummary = useUpdateInspectionSummary();

  const inspection = inspectionEnv?.inspection;
  const summary = summaryEnv?.summary;

  const [forensicText, setForensicText] = useState("");
  const [repairabilityText, setRepairabilityText] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");

  // Init state from server only once per load or when it changes fundamentally
  useEffect(() => {
    if (summary) {
      setForensicText(summary.forensicSummary || "");
      setRepairabilityText(summary.repairabilityText || "");
    }
  }, [summary]);

  const handleGenerate = () => {
    generateSummary.mutate(
      { inspectionId: id, data: { userPrompt: customPrompt || undefined } },
      {
        onSuccess: (newSummaryEnv) => {
          queryClient.setQueryData(getGetInspectionSummaryQueryKey(id), newSummaryEnv);
          setForensicText(newSummaryEnv.summary?.forensicSummary || "");
          setRepairabilityText(newSummaryEnv.summary?.repairabilityText || "");
          toast({ title: "Summary generated", description: "AI has produced a new narrative." });
          setCustomPrompt("");
        },
        onError: () => {
          toast({ title: "Generation failed", description: "Could not generate summary.", variant: "destructive" });
        }
      }
    );
  };

  const handleSaveEdits = () => {
    updateSummary.mutate(
      { inspectionId: id, data: { forensicSummary: forensicText, repairabilityText: repairabilityText } },
      {
        onSuccess: (updatedEnv) => {
          queryClient.setQueryData(getGetInspectionSummaryQueryKey(id), updatedEnv);
          setIsEditing(false);
          toast({ title: "Saved", description: "Summary text updated." });
        },
        onError: () => {
          toast({ title: "Save failed", description: "Could not save your edits.", variant: "destructive" });
        }
      }
    );
  };

  const cancelEdits = () => {
    setIsEditing(false);
    if (summary) {
      setForensicText(summary.forensicSummary || "");
      setRepairabilityText(summary.repairabilityText || "");
    }
  };

  if (isInspectionLoading || isSummaryLoading) {
    return (
      <Shell>
        <div className="space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-32 w-full" />
        </div>
      </Shell>
    );
  }

  if (!inspection) {
    return <Shell><div>Inspection not found.</div></Shell>;
  }

  return (
    <Shell>
      <div className="mb-6">
        <Link href="/inspections" className="text-muted-foreground hover:text-foreground text-sm flex items-center gap-1 mb-4 w-fit">
          <ArrowLeft className="h-4 w-4" /> Back to Inspections
        </Link>
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">AI Summary</h1>
            <p className="text-muted-foreground">{inspection.address}</p>
          </div>
          <div className="flex gap-2">
            <Link href={`/inspections/${id}/estimate`} className="inline-block">
              <Button variant="outline">View Estimate</Button>
            </Link>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-6">
          <Card>
            <CardHeader className="flex flex-row justify-between items-center pb-4">
              <div>
                <CardTitle>Forensic Narrative</CardTitle>
                <CardDescription>Generated assessment of field evidence.</CardDescription>
              </div>
              {!isEditing && summary && (
                <Button variant="secondary" size="sm" onClick={() => setIsEditing(true)}>Edit Text</Button>
              )}
            </CardHeader>
            <CardContent>
              {summary ? (
                <div className="space-y-6">
                  {isEditing ? (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Forensic Summary</label>
                        <Textarea 
                          className="min-h-[200px]" 
                          value={forensicText} 
                          onChange={(e) => setForensicText(e.target.value)} 
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Repairability Text</label>
                        <Textarea 
                          className="min-h-[150px]" 
                          value={repairabilityText} 
                          onChange={(e) => setRepairabilityText(e.target.value)} 
                        />
                      </div>
                      <div className="flex gap-2 justify-end">
                        <Button variant="outline" onClick={cancelEdits}>Cancel</Button>
                        <Button onClick={handleSaveEdits} disabled={updateSummary.isPending}>
                          {updateSummary.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                          Save Changes
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="prose dark:prose-invert max-w-none text-sm">
                        <h4 className="text-base font-semibold mb-2 text-foreground">Forensic Summary</h4>
                        <p className="whitespace-pre-wrap text-muted-foreground">{summary.forensicSummary}</p>
                      </div>
                      <div className="prose dark:prose-invert max-w-none text-sm border-t pt-4">
                        <h4 className="text-base font-semibold mb-2 text-foreground">Repairability</h4>
                        <p className="whitespace-pre-wrap text-muted-foreground">{summary.repairabilityText}</p>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground border-t pt-4">
                        <span>Generated: {format(new Date(summary.generatedAt), 'MMM d, h:mm a')}</span>
                        {summary.editedAt && (
                          <span>Last edited: {format(new Date(summary.editedAt), 'MMM d, h:mm a')} {summary.editedBy && `by ${summary.editedBy}`}</span>
                        )}
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <FileText className="h-12 w-12 mx-auto opacity-20 mb-4" />
                  <p>No summary has been generated yet.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" /> Generate
              </CardTitle>
              <CardDescription>Trigger the AI brain to analyze evidence.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea 
                placeholder="Optional custom instructions..." 
                className="resize-none"
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
              />
              <Button className="w-full" onClick={handleGenerate} disabled={generateSummary.isPending}>
                {generateSummary.isPending ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processing...</>
                ) : (
                  "Generate Summary"
                )}
              </Button>
            </CardContent>
          </Card>

          {summary && (
            <Card>
              <CardHeader>
                <CardTitle>AI Metadata</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between items-center pb-2 border-b">
                  <span className="text-sm font-medium text-muted-foreground">Confidence</span>
                  <Badge variant={summary.confidence === 'high' ? 'default' : summary.confidence === 'medium' ? 'secondary' : 'destructive'} className="uppercase">
                    {summary.confidence || 'unknown'}
                  </Badge>
                </div>

                {summary.qualityFlags && summary.qualityFlags.length > 0 && (
                  <div className="space-y-2">
                    <span className="text-sm font-medium flex items-center gap-1 text-amber-600 dark:text-amber-500">
                      <AlertTriangle className="h-4 w-4" /> Quality Flags
                    </span>
                    <ul className="text-sm text-muted-foreground space-y-1 list-disc pl-5">
                      {summary.qualityFlags.map((flag, idx) => <li key={idx}>{flag}</li>)}
                    </ul>
                  </div>
                )}

                {summary.missingOrUnverifiedItems && summary.missingOrUnverifiedItems.length > 0 && (
                  <div className="space-y-2 pt-2 border-t">
                    <span className="text-sm font-medium flex items-center gap-1 text-blue-600 dark:text-blue-500">
                      <Info className="h-4 w-4" /> Missing Info
                    </span>
                    <ul className="text-sm text-muted-foreground space-y-1 list-disc pl-5">
                      {summary.missingOrUnverifiedItems.map((item, idx) => <li key={idx}>{item}</li>)}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </Shell>
  );
}
