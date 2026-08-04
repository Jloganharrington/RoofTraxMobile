/**
 * EstimatePanel — estimate content without Shell wrapper.
 * Used both by the standalone Estimate page and the ClaimHub Estimate tab.
 */
import { useState, useEffect } from "react";
import {
  useGetInspectionEstimate,
  useSaveInspectionEstimate,
  useListPriceBookItems,
  getGetInspectionEstimateQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Trash2, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { EstimateLineItem } from "@workspace/api-client-react";

interface EstimatePanelProps {
  inspectionId: string;
}

export function EstimatePanel({ inspectionId }: EstimatePanelProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const id = inspectionId;

  const { data: estimateEnv, isLoading: isEstimateLoading } = useGetInspectionEstimate(id, {
    query: { enabled: !!id, queryKey: getGetInspectionEstimateQueryKey(id) },
  });
  const { data: priceBookEnv } = useListPriceBookItems();
  const saveEstimate = useSaveInspectionEstimate();

  const initEstimate = estimateEnv?.estimate;
  const priceBookItems = priceBookEnv?.items || [];

  const [wastePercent, setWastePercent] = useState<number>(0);
  const [lines, setLines] = useState<EstimateLineItem[]>([]);
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (initEstimate && !isDirty) {
      setWastePercent(initEstimate.wastePercent || 0);
      setLines(initEstimate.lines || []);
    }
  }, [initEstimate, isDirty]);

  const addLine = () => {
    setLines([...lines, { description: "", quantity: 1, unitPriceCents: 0, isAdder: false }]);
    setIsDirty(true);
  };

  const removeLine = (index: number) => {
    setLines(lines.filter((_, i) => i !== index));
    setIsDirty(true);
  };

  const updateLine = (index: number, updates: Partial<EstimateLineItem>) => {
    const newLines = [...lines];
    newLines[index] = { ...newLines[index], ...updates };
    setLines(newLines);
    setIsDirty(true);
  };

  const applyPriceBookItem = (index: number, itemId: string) => {
    const item = priceBookItems.find((i) => i.id === itemId);
    if (!item) return;
    updateLine(index, {
      priceBookItemId: item.id,
      description: item.name,
      unit: item.unit,
      unitPriceCents: item.unitPrice,
    });
  };

  const subtotalCents = lines.reduce((acc, line) => acc + line.quantity * line.unitPriceCents, 0);
  const wasteMultiplier = 1 + wastePercent / 100;
  const totalCents = Math.round(subtotalCents * wasteMultiplier);

  const handleSave = () => {
    saveEstimate.mutate(
      {
        inspectionId: id,
        data: {
          wastePercent,
          lines: lines.map((l) => ({ ...l, unitPriceCents: Math.round(l.unitPriceCents) })),
        },
      },
      {
        onSuccess: (resEnv) => {
          queryClient.setQueryData(getGetInspectionEstimateQueryKey(id), resEnv);
          setIsDirty(false);
          toast({ title: "Estimate saved" });
        },
        onError: () =>
          toast({ title: "Save failed", variant: "destructive" }),
      },
    );
  };

  if (isEstimateLoading) {
    return <div className="py-12 text-center text-muted-foreground text-sm">Loading estimate…</div>;
  }

  const basis = initEstimate?.measuredBasis;

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          onClick={() => {
            setIsDirty(false);
            setWastePercent(initEstimate?.wastePercent || 0);
            setLines(initEstimate?.lines || []);
          }}
          disabled={!isDirty}
        >
          Discard
        </Button>
        <Button onClick={handleSave} disabled={saveEstimate.isPending || !isDirty}>
          {saveEstimate.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          Save Estimate
        </Button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        {/* Line items */}
        <div className="xl:col-span-3">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle>Line Items</CardTitle>
            </CardHeader>
            <div className="border-t">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[300px]">Description</TableHead>
                    <TableHead className="w-24">Unit</TableHead>
                    <TableHead className="w-24">Qty</TableHead>
                    <TableHead className="w-32">Unit Price</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line, idx) => (
                    <TableRow key={idx}>
                      <TableCell>
                        <div className="flex flex-col gap-2">
                          <Select
                            value={line.priceBookItemId || "manual"}
                            onValueChange={(val) => {
                              if (val !== "manual") applyPriceBookItem(idx, val);
                              else updateLine(idx, { priceBookItemId: null });
                            }}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="Select catalog item…" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="manual" className="font-semibold">
                                Manual Entry
                              </SelectItem>
                              {priceBookItems.map((item) => (
                                <SelectItem key={item.id} value={item.id}>
                                  {item.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Input
                            value={line.description}
                            onChange={(e) => updateLine(idx, { description: e.target.value })}
                            placeholder="Description"
                            className="h-8 text-sm"
                          />
                        </div>
                      </TableCell>
                      <TableCell>
                        <Input
                          value={line.unit || ""}
                          onChange={(e) => updateLine(idx, { unit: e.target.value })}
                          placeholder="e.g. SQ"
                          className="h-8"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          value={line.quantity}
                          onChange={(e) =>
                            updateLine(idx, { quantity: Number(e.target.value) })
                          }
                          className="h-8"
                        />
                      </TableCell>
                      <TableCell>
                        <div className="relative">
                          <span className="absolute left-2 top-1.5 text-muted-foreground text-sm">
                            $
                          </span>
                          <Input
                            type="number"
                            value={(line.unitPriceCents / 100).toFixed(2)}
                            onChange={(e) =>
                              updateLine(idx, {
                                unitPriceCents: Math.round(Number(e.target.value) * 100),
                              })
                            }
                            className="h-8 pl-5"
                            step="0.01"
                          />
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        ${((line.quantity * line.unitPriceCents) / 100).toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive"
                          onClick={() => removeLine(idx)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {lines.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="h-24 text-center text-muted-foreground text-sm"
                      >
                        No lines added yet. Click &ldquo;Add Item&rdquo; to start.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            <CardFooter className="pt-4 flex justify-between bg-muted/20 border-t">
              <Button variant="outline" size="sm" onClick={addLine}>
                <Plus className="h-4 w-4 mr-2" /> Add Item
              </Button>
              <div className="text-lg font-bold">
                Subtotal: ${(subtotalCents / 100).toFixed(2)}
              </div>
            </CardFooter>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Parameters</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Waste Factor (%)</label>
                <div className="relative">
                  <Input
                    type="number"
                    value={wastePercent}
                    onChange={(e) => {
                      setWastePercent(Number(e.target.value));
                      setIsDirty(true);
                    }}
                  />
                  <span className="absolute right-3 top-2 text-muted-foreground">%</span>
                </div>
              </div>
              <div className="pt-4 border-t space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span>${(subtotalCents / 100).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Waste Added</span>
                  <span>+${(((totalCents - subtotalCents) / 100)).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-lg font-bold pt-2 border-t text-primary">
                  <span>Total</span>
                  <span>${(totalCents / 100).toFixed(2)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Measured Basis</CardTitle>
              <CardDescription>Context from field app.</CardDescription>
            </CardHeader>
            <CardContent>
              {basis ? (
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between border-b pb-2">
                    <span className="text-muted-foreground">Roof Area</span>
                    <span className="font-medium">{basis.totalRoofSqft || 0} sqft</span>
                  </div>
                  <div className="flex justify-between border-b pb-2">
                    <span className="text-muted-foreground">Total Squares</span>
                    <span className="font-medium">{basis.totalRoofSquares || 0} SQ</span>
                  </div>
                  <div className="flex justify-between pb-2">
                    <span className="text-muted-foreground">Adjusted Squares</span>
                    <span className="font-medium">{basis.adjustedRoofSquares || 0} SQ</span>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No measurements provided.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
