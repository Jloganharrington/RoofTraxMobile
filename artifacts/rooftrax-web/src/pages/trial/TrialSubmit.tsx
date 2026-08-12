import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { ShieldCheck, ArrowRight, ArrowLeft, Loader2, Check, Upload, File as FileIcon, X, AlertTriangle, Lock } from "lucide-react";
import { format } from "date-fns";

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY",
  "LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND",
  "OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

const PERILS = [
  { value: "hail", label: "Hail" },
  { value: "wind", label: "Wind" },
  { value: "wind_hail", label: "Wind & Hail" },
  { value: "tree_impact", label: "Tree Impact" },
  { value: "other", label: "Other" },
];

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-bold uppercase tracking-widest text-zinc-400 mb-2">
        {label}{required && <span className="text-orange-500 ml-1">*</span>}
      </label>
      {children}
    </div>
  );
}

const inputClass = "w-full bg-zinc-900 border border-white/10 text-white text-sm px-4 py-3 placeholder:text-zinc-600 focus:outline-none focus:border-orange-500/50 transition-colors disabled:opacity-50";
const selectClass = "w-full bg-zinc-900 border border-white/10 text-white text-sm px-4 py-3 focus:outline-none focus:border-orange-500/50 transition-colors appearance-none cursor-pointer disabled:opacity-50";

export default function TrialSubmit() {
  const [loc, navigate] = useLocation();
  const [token, setToken] = useState<string | null>(null);
  const [account, setAccount] = useState<any>(null);
  const [config, setConfig] = useState<any>(null);
  const [submission, setSubmission] = useState<any>(null);
  const [uploads, setUploads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);

  // Form state
  const [form, setForm] = useState({
    propertyAddress: "",
    propertyCity: "",
    propertyState: "",
    propertyZip: "",
    county: "",
    dateOfLoss: "",
    perilType: "",
    roofSystem: "",
    stories: "",
    carrierName: "",
    claimNumberRef: "",
    scopeNotes: "",
    brandColorHex: "#F97316",
    licenseDisplay: "",
  });

  const [terms, setTerms] = useState({ auth: false, review: false, accept: false });

  // Init auth
  useEffect(() => {
    let t = localStorage.getItem("rt_trial_token");
    if (window.location.hash.includes("trial_token=")) {
      const match = window.location.hash.match(/trial_token=([^&]+)/);
      if (match) {
        t = match[1];
        localStorage.setItem("rt_trial_token", t);
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      }
    }
    if (!t) {
      navigate("/proof-package/start");
    } else {
      setToken(t);
    }
  }, [navigate]);

  // Load data
  useEffect(() => {
    if (!token) return;
    const load = async () => {
      try {
        const [meRes, cfgRes, subRes] = await Promise.all([
          fetch(`/api/trial/me`, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`/api/trial/config`),
          fetch(`/api/trial/submissions`, { 
            method: "POST", 
            headers: { Authorization: `Bearer ${token}` }
          })
        ]);

        if (!meRes.ok) throw new Error("Failed to load account");
        if (!cfgRes.ok) throw new Error("Failed to load config");

        const me = await meRes.json();
        const cfg = await cfgRes.json();
        
        setAccount(me.account);
        setConfig(cfg);
        
        if (me.submissions?.length >= cfg.maxPackages) {
          // Cap reached handled in render
          setLoading(false);
          return;
        }

        if (!subRes.ok) {
          const body = await subRes.json().catch(() => ({}));
          if (body.code === 'cap_reached') {
            setLoading(false);
            return;
          }
          throw new Error("Failed to initialize draft");
        }

        const sub = (await subRes.json()).submission;
        setSubmission(sub);
        
        // Fetch full sub details for uploads
        const detailRes = await fetch(`/api/trial/submissions/${sub.id}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (detailRes.ok) {
          const det = await detailRes.json();
          setUploads(det.uploads || []);
          
          setForm({
            propertyAddress: det.submission.propertyAddress || "",
            propertyCity: det.submission.propertyCity || "",
            propertyState: det.submission.propertyState || "",
            propertyZip: det.submission.propertyZip || "",
            county: det.submission.county || "",
            dateOfLoss: det.submission.dateOfLoss || "",
            perilType: det.submission.perilType || "",
            roofSystem: det.submission.roofSystem || "",
            stories: det.submission.stories?.toString() || "",
            carrierName: det.submission.carrierName || "",
            claimNumberRef: det.submission.claimNumberRef || "",
            scopeNotes: det.submission.scopeNotes || "",
            brandColorHex: det.submission.brandColorHex || "#F97316",
            licenseDisplay: det.submission.licenseDisplay || me.account.licenseNumber || "",
          });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [token]);

  const lastSaved = useRef(form);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const patchSubmission = useCallback(async (data: Partial<typeof form>) => {
    if (!submission || !token) return;
    setSaving(true);
    try {
      
      const payload: any = { ...data };
      if (payload.stories) payload.stories = parseInt(payload.stories, 10);
      
      const res = await fetch(`/api/trial/submissions/${submission.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error("Failed to save");
      
      const resData = await res.json();
      
      // Coverage gate check
      if (resData.coverage && resData.coverage !== "covered") {
        navigate(`/proof-package/waitlist?state=${data.propertyState || form.propertyState}&county=${data.county || form.county}&reason=coverage`);
      }
      
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }, [submission, token, navigate, form.propertyState, form.county]);

  // Auto-save
  useEffect(() => {
    if (loading || !submission) return;
    const changed = Object.keys(form).some(k => form[k as keyof typeof form] !== lastSaved.current[k as keyof typeof form]);
    if (changed) {
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        patchSubmission(form);
        lastSaved.current = form;
      }, 1000);
    }
  }, [form, loading, submission, patchSubmission]);

  const setF = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, fileType: string) => {
    const files = e.target.files;
    if (!files || !files.length || !submission || !token) return;
    const file = files[0];
    
    // Quick validation
    if (fileType === "photo" && !file.type.startsWith("image/")) return alert("Must be an image");
    if (file.size > 15 * 1024 * 1024) return alert("File too large (max 15MB)");

    setSaving(true);
    try {
      // Request URL
      const reqRes = await fetch(`/api/trial/submissions/${submission.id}/uploads/request-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          fileName: file.name,
          fileType,
          contentType: file.type,
          sizeBytes: file.size
        })
      });
      if (!reqRes.ok) throw new Error("Upload request failed");
      const { uploadURL, objectPath } = await reqRes.json();

      // PUT file
      await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file
      });

      // Confirm
      const confRes = await fetch(`/api/trial/submissions/${submission.id}/uploads`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ objectPath, fileName: file.name, fileType, sizeBytes: file.size })
      });
      if (!confRes.ok) throw new Error("Upload confirm failed");
      
      const { upload } = await confRes.json();
      setUploads(u => [...u, upload]);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setSaving(false);
      e.target.value = '';
    }
  };

  const removeUpload = async (id: string) => {
    if (!token) return;
    setUploads(u => u.filter(x => x.id !== id));
    try {
      await fetch(`/api/trial/uploads/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch (err) {
      console.error(err);
    }
  };

  const handleCheckout = async () => {
    if (!terms.auth || !terms.review || !terms.accept) {
      setCheckoutError("Please accept all terms to continue.");
      return;
    }
    
    // Force final save before checkout
    clearTimeout(debounceRef.current);
    await patchSubmission(form);
    
    setLoading(true);
    setCheckoutError(null);
    try {
      const res = await fetch(`/api/trial/submissions/${submission.id}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ acceptAuthorized: true, acceptReviewResponsibility: true, acceptTerms: true })
      });
      
      const body = await res.json().catch(() => ({}));
      
      if (res.status === 503 || body.code === 'payments_not_configured') {
        setCheckoutError("Payments are currently being configured for your account. We'll reach out shortly to complete your order and begin processing.");
        setLoading(false);
        return;
      }
      
      if (!res.ok) {
        if (body.missing?.length) {
          throw new Error(`Missing required fields: ${body.missing.join(", ")}`);
        }
        throw new Error(body.error || "Checkout failed");
      }

      if (body.checkoutUrl) {
        window.location.href = body.checkoutUrl;
      }
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : "Checkout error");
      setLoading(false);
    }
  };

  if (loading && !submission && !error) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-orange-500 font-bold uppercase tracking-widest text-xs animate-pulse">Loading...</div>
      </div>
    );
  }

  if (error || (account && account.packagesPurchased >= config?.maxPackages)) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-6 text-center">
        <div className="h-16 w-16 bg-white/5 border border-white/10 flex items-center justify-center mb-6">
          <ShieldCheck className="h-8 w-8 text-white" />
        </div>
        <h1 className="text-2xl font-black uppercase text-white mb-4">
          {error ? "Error" : "You've used all three trial packages."}
        </h1>
        <p className="text-zinc-400 max-w-md leading-relaxed mb-8">
          {error || "The next step is a plan — here's what that looks like."}
        </p>
        <button
          onClick={() => navigate(error ? "/" : "/signup")}
          className="inline-flex items-center gap-2 px-6 py-3 bg-orange-500 hover:bg-orange-400 text-black text-xs font-black uppercase tracking-widest transition-colors"
        >
          {error ? "Back Home" : "View Plans"} <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    );
  }

  const nextDisabled = 
    (step === 1 && (!form.propertyAddress || !form.propertyCity || !form.propertyState || !form.propertyZip || !form.county || !form.dateOfLoss || !form.perilType)) ||
    (step === 2 && (!form.carrierName || !form.claimNumberRef)) ||
    (step === 3 && (!form.brandColorHex || !form.licenseDisplay));

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col">
      <nav className="h-14 flex items-center justify-between px-6 md:px-10 border-b border-white/10 shrink-0 sticky top-0 bg-zinc-950/90 backdrop-blur z-10">
        <button onClick={() => navigate("/")} className="flex items-center gap-2.5">
          <ShieldCheck className="h-5 w-5 text-orange-500" strokeWidth={2.5} />
          <span className="text-lg font-black tracking-widest uppercase">
            <span className="text-white">ROOF</span><span className="text-orange-500">TRAX</span>
          </span>
        </button>
        <div className="flex items-center gap-4">
          <span className={`text-[10px] font-bold uppercase tracking-widest transition-opacity ${saving ? "text-orange-500 opacity-100" : "text-zinc-500 opacity-0"}`}>Saving...</span>
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-zinc-500 hover:text-white transition-colors"
          >
            Save & Exit
          </button>
        </div>
      </nav>

      <div className="flex-1 max-w-3xl w-full mx-auto p-6 md:py-12">
        <div className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <div className="text-[11px] font-bold uppercase tracking-widest text-orange-500">Step {step} of 4</div>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className={`h-1 w-8 transition-colors ${i <= step ? "bg-orange-500" : "bg-white/10"}`} />
              ))}
            </div>
          </div>
          <h1 className="text-3xl font-black uppercase text-white">
            {step === 1 && "Property & Loss"}
            {step === 2 && "Claim Context"}
            {step === 3 && "Branding"}
            {step === 4 && "Review & Terms"}
          </h1>
        </div>

        <div className="space-y-8">
          {step === 1 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <Field label="Property Address" required>
                <input required value={form.propertyAddress} onChange={setF("propertyAddress")} className={inputClass} placeholder="123 Main St" />
              </Field>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="col-span-2 md:col-span-2">
                  <Field label="City" required>
                    <input required value={form.propertyCity} onChange={setF("propertyCity")} className={inputClass} placeholder="Dallas" />
                  </Field>
                </div>
                <Field label="State" required>
                  <select required value={form.propertyState} onChange={setF("propertyState")} className={selectClass}>
                    <option value="" disabled>St</option>
                    {STATES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </Field>
                <Field label="Zip" required>
                  <input required value={form.propertyZip} onChange={setF("propertyZip")} className={inputClass} placeholder="75201" />
                </Field>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="County" required>
                  <input required value={form.county} onChange={setF("county")} className={inputClass} placeholder="Dallas County" />
                </Field>
                <Field label="Date of Loss" required>
                  <input required type="date" value={form.dateOfLoss} onChange={setF("dateOfLoss")} className={inputClass} />
                </Field>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Field label="Peril Type" required>
                  <select required value={form.perilType} onChange={setF("perilType")} className={selectClass}>
                    <option value="" disabled>Select...</option>
                    {PERILS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </Field>
                <Field label="Roof System">
                  <input value={form.roofSystem} onChange={setF("roofSystem")} className={inputClass} placeholder="Architectural Shingle" />
                </Field>
                <Field label="Stories">
                  <input type="number" value={form.stories} onChange={setF("stories")} className={inputClass} placeholder="1" />
                </Field>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Carrier Name" required>
                  <input required value={form.carrierName} onChange={setF("carrierName")} className={inputClass} placeholder="State Farm" />
                </Field>
                <Field label="Claim Number" required>
                  <input required value={form.claimNumberRef} onChange={setF("claimNumberRef")} className={inputClass} placeholder="42-1234-56" />
                </Field>
              </div>
              
              <Field label="Scope Notes">
                <textarea 
                  value={form.scopeNotes} 
                  onChange={setF("scopeNotes")} 
                  maxLength={2000} 
                  rows={5}
                  className={`${inputClass} resize-none`} 
                  placeholder="Notes for the review team on damage specifics..." 
                />
                <div className="text-right text-[10px] text-zinc-600 mt-1">{form.scopeNotes.length}/2000</div>
              </Field>

              <div className="border border-white/10 p-6 bg-zinc-900/30">
                <h3 className="text-sm font-black uppercase text-white mb-1">Evidence & Documents</h3>
                <p className="text-xs text-zinc-400 mb-6">Photos, measurement reports (PDF), carrier estimates.</p>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                  <label className="flex items-center justify-center gap-2 p-4 border border-dashed border-white/20 hover:border-orange-500/50 hover:bg-orange-500/5 transition-colors cursor-pointer text-xs font-bold uppercase tracking-widest text-zinc-300">
                    <Upload className="h-4 w-4" /> Add Photos
                    <input type="file" multiple accept="image/jpeg,image/png,image/heic" className="hidden" onChange={(e) => handleFileUpload(e, "photo")} />
                  </label>
                  <label className="flex items-center justify-center gap-2 p-4 border border-dashed border-white/20 hover:border-orange-500/50 hover:bg-orange-500/5 transition-colors cursor-pointer text-xs font-bold uppercase tracking-widest text-zinc-300">
                    <Upload className="h-4 w-4" /> Add Report/Est
                    <input type="file" accept=".pdf,.xlsx" className="hidden" onChange={(e) => handleFileUpload(e, "measurement_report")} />
                  </label>
                </div>

                {uploads.length > 0 && (
                  <div className="space-y-2">
                    {uploads.map(u => (
                      <div key={u.id} className="flex items-center justify-between p-3 bg-zinc-950 border border-white/10">
                        <div className="flex items-center gap-3 overflow-hidden">
                          <FileIcon className="h-4 w-4 text-zinc-500 shrink-0" />
                          <span className="text-xs text-zinc-300 truncate">{u.fileName}</span>
                          <span className="text-[10px] text-zinc-600 shrink-0">{(u.sizeBytes / 1024 / 1024).toFixed(1)}MB</span>
                        </div>
                        <button onClick={() => removeUpload(u.id)} className="p-1 hover:text-red-400 text-zinc-500 transition-colors">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="border border-white/10 p-6 bg-zinc-900/30">
                <h3 className="text-sm font-black uppercase text-white mb-1">Company Logo</h3>
                <p className="text-xs text-zinc-400 mb-6">PNG or SVG with transparent background preferred.</p>
                <label className="inline-flex items-center justify-center gap-2 px-6 py-3 border border-white/20 hover:border-orange-500/50 hover:bg-orange-500/5 transition-colors cursor-pointer text-xs font-bold uppercase tracking-widest text-zinc-300">
                  <Upload className="h-4 w-4" /> Upload Logo
                  <input type="file" accept=".png,.svg" className="hidden" onChange={(e) => handleFileUpload(e, "logo")} />
                </label>
                {uploads.filter(u => u.fileType === "logo").length > 0 && (
                  <div className="mt-4 flex items-center gap-3">
                    <Check className="h-4 w-4 text-green-500" />
                    <span className="text-xs text-zinc-400">Logo uploaded</span>
                  </div>
                )}
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Brand Color Hex" required>
                  <div className="flex items-center gap-3">
                    <input 
                      type="color" 
                      value={form.brandColorHex} 
                      onChange={setF("brandColorHex")} 
                      className="h-10 w-12 bg-transparent p-0 border-0 cursor-pointer"
                    />
                    <input 
                      required 
                      value={form.brandColorHex} 
                      onChange={setF("brandColorHex")} 
                      className={inputClass} 
                    />
                  </div>
                </Field>
                <Field label="License Number for Docs" required>
                  <input required value={form.licenseDisplay} onChange={setF("licenseDisplay")} className={inputClass} />
                </Field>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="bg-zinc-900 border border-white/10 p-6 space-y-6">
                <div className="flex justify-between items-start border-b border-white/10 pb-6">
                  <div>
                    <h3 className="text-lg font-black uppercase text-white">{form.propertyAddress}</h3>
                    <p className="text-sm text-zinc-400">{form.propertyCity}, {form.propertyState} {form.propertyZip}</p>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Total</div>
                    <div className="text-2xl font-black text-orange-500">
                      ${submission.sequenceNum === 1 ? config?.priceFirstCents / 100 || 100 : config?.priceSubsequentCents / 100 || 65}
                    </div>
                  </div>
                </div>
                
                <div className="space-y-4">
                  <label className="flex items-start gap-3 cursor-pointer group">
                    <div className={`mt-0.5 h-5 w-5 shrink-0 border flex items-center justify-center transition-colors ${terms.auth ? "bg-orange-500 border-orange-500" : "bg-zinc-950 border-white/20 group-hover:border-white/40"}`}>
                      {terms.auth && <Check className="h-3.5 w-3.5 text-black" strokeWidth={3} />}
                    </div>
                    <input type="checkbox" className="sr-only" checked={terms.auth} onChange={e => setTerms(t => ({...t, auth: e.target.checked}))} />
                    <span className="text-sm text-zinc-300">I am authorized to share this claim and property information.</span>
                  </label>
                  
                  <label className="flex items-start gap-3 cursor-pointer group">
                    <div className={`mt-0.5 h-5 w-5 shrink-0 border flex items-center justify-center transition-colors ${terms.review ? "bg-orange-500 border-orange-500" : "bg-zinc-950 border-white/20 group-hover:border-white/40"}`}>
                      {terms.review && <Check className="h-3.5 w-3.5 text-black" strokeWidth={3} />}
                    </div>
                    <input type="checkbox" className="sr-only" checked={terms.review} onChange={e => setTerms(t => ({...t, review: e.target.checked}))} />
                    <span className="text-sm text-zinc-300">I understand this package is prepared for my review and adoption, and that I am responsible for reviewing it before submitting it to any carrier.</span>
                  </label>
                  
                  <label className="flex items-start gap-3 cursor-pointer group">
                    <div className={`mt-0.5 h-5 w-5 shrink-0 border flex items-center justify-center transition-colors ${terms.accept ? "bg-orange-500 border-orange-500" : "bg-zinc-950 border-white/20 group-hover:border-white/40"}`}>
                      {terms.accept && <Check className="h-3.5 w-3.5 text-black" strokeWidth={3} />}
                    </div>
                    <input type="checkbox" className="sr-only" checked={terms.accept} onChange={e => setTerms(t => ({...t, accept: e.target.checked}))} />
                    <span className="text-sm text-zinc-300">I have read and accept the Trial Package Terms and Privacy Policy.</span>
                  </label>
                </div>
              </div>

              {checkoutError && (
                <div className="bg-red-500/10 border border-red-500/30 p-4 flex gap-3 text-sm text-red-400">
                  <AlertTriangle className="h-5 w-5 shrink-0" />
                  <p>{checkoutError}</p>
                </div>
              )}
            </div>
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between pt-8 border-t border-white/10 mt-10">
            {step > 1 ? (
              <button 
                onClick={() => setStep(s => s - 1)}
                className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-zinc-400 hover:text-white transition-colors py-3"
              >
                <ArrowLeft className="h-4 w-4" /> Previous
              </button>
            ) : <div />}
            
            {step < 4 ? (
              <button 
                onClick={() => setStep(s => s + 1)}
                disabled={nextDisabled || saving}
                className="flex items-center gap-2 px-8 py-4 bg-white hover:bg-zinc-200 disabled:opacity-50 text-black text-xs font-black uppercase tracking-widest transition-colors"
              >
                Continue <ArrowRight className="h-4 w-4" />
              </button>
            ) : (
              <button 
                onClick={handleCheckout}
                disabled={loading || saving || !terms.accept || !terms.auth || !terms.review}
                className="flex items-center gap-2 px-8 py-4 bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-black text-xs font-black uppercase tracking-widest transition-colors"
              >
                {loading ? "Processing..." : "Complete & Pay"} <Lock className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
