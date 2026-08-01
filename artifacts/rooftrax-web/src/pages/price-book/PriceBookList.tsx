import { useState } from "react";
import { useListPriceBookItems, useCreatePriceBookItem, useUpdatePriceBookItem, useDeletePriceBookItem, getListPriceBookItemsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Shell } from "@/components/layout/Shell";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import { Loader2, Plus, Edit2, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { PriceBookItem } from "@workspace/api-client-react";

export default function PriceBookList() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: priceBookEnv, isLoading } = useListPriceBookItems();
  const items = priceBookEnv?.items || [];

  const createItem = useCreatePriceBookItem();
  const updateItem = useUpdatePriceBookItem();
  const deleteItem = useDeletePriceBookItem();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<PriceBookItem | null>(null);
  
  // Form State
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [price, setPrice] = useState(""); // dollars

  const openCreateDialog = () => {
    setEditingItem(null);
    setName("");
    setUnit("");
    setPrice("");
    setIsDialogOpen(true);
  };

  const openEditDialog = (item: PriceBookItem) => {
    setEditingItem(item);
    setName(item.name);
    setUnit(item.unit || "");
    setPrice(item.unitPrice.toString());
    setIsDialogOpen(true);
  };

  const handleSave = () => {
    const numPrice = Number(price);
    if (!name || isNaN(numPrice)) {
      toast({ title: "Validation Error", description: "Name and valid price are required.", variant: "destructive" });
      return;
    }

    const payload = { name, unit: unit || undefined, unitPrice: numPrice, description: "" };

    if (editingItem) {
      updateItem.mutate(
        { itemId: editingItem.id, data: payload },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListPriceBookItemsQueryKey() });
            setIsDialogOpen(false);
            toast({ title: "Item updated" });
          }
        }
      );
    } else {
      createItem.mutate(
        { data: payload },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListPriceBookItemsQueryKey() });
            setIsDialogOpen(false);
            toast({ title: "Item created" });
          }
        }
      );
    }
  };

  const handleDelete = (id: string) => {
    if(!window.confirm("Delete this catalog item?")) return;
    deleteItem.mutate(
      { itemId: id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPriceBookItemsQueryKey() });
          toast({ title: "Item deleted" });
        }
      }
    );
  };

  const isPending = createItem.isPending || updateItem.isPending;

  return (
    <Shell>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Price Catalog</h1>
          <p className="text-muted-foreground">Manage base pricing for repair estimates.</p>
        </div>
        <Button onClick={openCreateDialog}><Plus className="mr-2 h-4 w-4" /> Add Item</Button>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingItem ? "Edit Item" : "Create Item"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium">Name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Remove & Replace Laminate Shingles" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <label className="text-sm font-medium">Unit</label>
                <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. SQ" />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium">Price ($)</label>
                <Input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={handleSave} disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Item
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <div className="border-t border-b-0 rounded-t-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="w-24">Unit</TableHead>
                <TableHead className="w-32 text-right">Price</TableHead>
                <TableHead className="w-24 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-32 text-center">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mx-auto mb-2" />
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-32 text-center text-muted-foreground">
                    Your price book is empty. Add your first item.
                  </TableCell>
                </TableRow>
              ) : (
                items.map(item => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell className="text-muted-foreground">{item.unit || "—"}</TableCell>
                    <TableCell className="text-right font-medium">${item.unitPrice.toFixed(2)}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" className="h-8 w-8 mr-1" onClick={() => openEditDialog(item)}>
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={() => handleDelete(item.id)} disabled={deleteItem.isPending}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </Shell>
  );
}
