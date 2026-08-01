import { useState, useMemo } from "react";
import { Link } from "wouter";
import { useListInspections } from "@workspace/api-client-react";
import { format } from "date-fns";
import { Shell } from "@/components/layout/Shell";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Loader2, FileText, Calculator } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function InspectionList() {
  const { data, isLoading } = useListInspections();
  const [searchTerm, setSearchTerm] = useState("");

  const inspections = data?.inspections || [];

  const filteredInspections = useMemo(() => {
    if (!searchTerm) return inspections;
    const term = searchTerm.toLowerCase();
    return inspections.filter(i => 
      (i.address?.toLowerCase().includes(term)) ||
      (i.status.toLowerCase().includes(term))
    );
  }, [inspections, searchTerm]);

  return (
    <Shell>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Inspections</h1>
          <p className="text-muted-foreground">Manage and review field captures.</p>
        </div>
        <div className="relative w-full md:w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search address..." 
            className="pl-9" 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <div className="border rounded-lg bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Address</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Date of Loss</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mx-auto mb-2" />
                  <span className="text-muted-foreground">Loading inspections...</span>
                </TableCell>
              </TableRow>
            ) : filteredInspections.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                  No inspections found.
                </TableCell>
              </TableRow>
            ) : (
              filteredInspections.map((inspection) => (
                <TableRow key={inspection.id} className="hover:bg-muted/30">
                  <TableCell className="font-medium">
                    {inspection.address || "No Address Provided"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">
                      {inspection.status.replace(/_/g, ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {inspection.dateOfLoss ? format(new Date(inspection.dateOfLoss), 'MMM d, yyyy') : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {format(new Date(inspection.createdAt), 'MMM d, yyyy')}
                  </TableCell>
                  <TableCell className="text-right space-x-2">
                    <Link href={`/inspections/${inspection.id}/summary`} className="inline-block">
                      <Button variant="ghost" size="sm" className="h-8 gap-1">
                        <FileText className="h-3.5 w-3.5" />
                        Summary
                      </Button>
                    </Link>
                    <Link href={`/inspections/${inspection.id}/estimate`} className="inline-block">
                      <Button variant="ghost" size="sm" className="h-8 gap-1">
                        <Calculator className="h-3.5 w-3.5" />
                        Estimate
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </Shell>
  );
}
