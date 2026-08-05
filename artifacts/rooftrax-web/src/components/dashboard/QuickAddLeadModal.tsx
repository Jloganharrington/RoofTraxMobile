import { useState } from "react";
import { useCreatePin, useGetMyProfile, getGetMyProfileQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListPinsQueryKey } from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useGetLeadSources, DEFAULT_LEAD_SOURCES } from "@/lib/claimHubApi";
import { Loader2 } from "lucide-react";

// ---------------------------------------------------------------------------
// Nominatim forward geocoder (US-biased, per workspace memory)
// ---------------------------------------------------------------------------
async function geocodeAddress(
  address: string,
): Promise<{ lat: number; lng: number } | null> {
  const params = new URLSearchParams({
    format: "json",
    q: address,
    countrycodes: "us",
    limit: "1",
  });
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?${params}`,
      { headers: { "Accept-Language": "en", "User-Agent": "RoofTrax/1.0" } },
    );
    if (!res.ok) return null;
    const results = (await res.json()) as Array<{ lat: string; lon: string }>;
    if (!results.length) return null;
    return { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Field component — keeps JSX below tidy
// ---------------------------------------------------------------------------
function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
        {label}
        {required && <span className="text-primary ml-1">*</span>}
      </label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  type = "text",
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className="w-full bg-background border border-input rounded-md px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
    />
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------
interface QuickAddLeadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function QuickAddLeadModal({ open, onOpenChange }: QuickAddLeadModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Profile → companyId for lead sources
  const { data: profileEnvelope } = useGetMyProfile({
    query: { queryKey: getGetMyProfileQueryKey(), enabled: open },
  });
  const companyId = profileEnvelope?.profile?.companyId ?? "";

  // Company-configured lead sources, falling back to defaults
  const { data: leadSourcesData } = useGetLeadSources(companyId, {
    enabled: open && !!companyId,
  });
  const leadSourceOptions: string[] = leadSourcesData?.leadSources?.length
    ? leadSourcesData.leadSources
    : [...DEFAULT_LEAD_SOURCES];

  const createPin = useCreatePin();

  // Form state
  const [name, setName]             = useState("");
  const [address, setAddress]       = useState("");
  const [phone, setPhone]           = useState("");
  const [email, setEmail]           = useState("");
  const [leadSource, setLeadSource] = useState<string>("");
  const [workflow, setWorkflow]     = useState<"retail" | "insurance">("retail");

  // Error state
  const [nameError, setNameError]       = useState("");
  const [addressError, setAddressError] = useState("");
  const [geocodeError, setGeocodeError] = useState("");

  const [isGeocoding, setIsGeocoding] = useState(false);
  const isBusy = isGeocoding || createPin.isPending;

  function reset() {
    setName("");
    setAddress("");
    setPhone("");
    setEmail("");
    setLeadSource("");
    setWorkflow("retail");
    setNameError("");
    setAddressError("");
    setGeocodeError("");
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Client-side validation
    let valid = true;
    if (!name.trim()) { setNameError("Name is required."); valid = false; }
    else setNameError("");

    if (!address.trim()) { setAddressError("Address is required."); valid = false; }
    else setAddressError("");

    if (!valid) return;

    // Forward-geocode the address
    setIsGeocoding(true);
    setGeocodeError("");
    const coords = await geocodeAddress(address.trim());
    setIsGeocoding(false);

    if (!coords) {
      setGeocodeError(
        'Address not found \u2014 try a more specific address (e.g. "123 Main St, Denver CO").',
      );
      return;
    }

    createPin.mutate(
      {
        data: {
          latitude: coords.lat,
          longitude: coords.lng,
          workflow,
          customerName: name.trim() || undefined,
          customerPhone: phone.trim() || undefined,
          externalLeadSource: (leadSource && leadSource !== '__none__') ? leadSource : undefined,
          ...(workflow === "retail"
            ? {
                retailData: {
                  ownerName1: name.trim(),
                  phone: phone.trim() || null,
                  email: email.trim() || null,
                  interestedRoof: false,
                  interestedSiding: false,
                  interestedWindows: false,
                  interestedDoors: false,
                },
              }
            : {}),
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPinsQueryKey() });
          toast({
            title: "Lead added",
            description: `${name.trim()} has been added to the pipeline.`,
          });
          handleOpenChange(false);
        },
        onError: () => {
          toast({
            title: "Failed to add lead",
            description: "Something went wrong. Please try again.",
            variant: "destructive",
          });
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base font-black uppercase tracking-wide"
            style={{ fontFamily: "var(--app-font-condensed)" }}>
            New Lead
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Fill in the details below. Address is used to place the lead on the map.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          <Field label="Name" required error={nameError}>
            <TextInput
              value={name}
              onChange={setName}
              placeholder="Jane Smith"
              disabled={isBusy}
            />
          </Field>

          <Field label="Address" required error={addressError || geocodeError}>
            <TextInput
              value={address}
              onChange={(v) => { setAddress(v); setGeocodeError(""); }}
              placeholder="123 Main St, Denver CO 80202"
              disabled={isBusy}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone">
              <TextInput
                value={phone}
                onChange={setPhone}
                placeholder="(303) 555-0100"
                type="tel"
                disabled={isBusy}
              />
            </Field>

            <Field label="Email">
              <TextInput
                value={email}
                onChange={setEmail}
                placeholder="jane@example.com"
                type="email"
                disabled={isBusy}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Lead Source">
              <Select
                value={leadSource}
                onValueChange={setLeadSource}
                disabled={isBusy}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">
                    <span className="text-muted-foreground">None / Canvass</span>
                  </SelectItem>
                  {leadSourceOptions.map((src) => (
                    <SelectItem key={src} value={src}>
                      {src}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Workflow">
              <Select
                value={workflow}
                onValueChange={(v) => setWorkflow(v as "retail" | "insurance")}
                disabled={isBusy}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="retail">Retail</SelectItem>
                  <SelectItem value="insurance">Insurance</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleOpenChange(false)}
              disabled={isBusy}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={isBusy}>
              {isGeocoding ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Locating…</>
              ) : createPin.isPending ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Adding…</>
              ) : (
                "Add Lead"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
