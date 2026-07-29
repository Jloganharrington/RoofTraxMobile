import { useState } from 'react';
import { useLocation } from 'wouter';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, ShieldCheck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function Home() {
  const [, setLocation] = useLocation();
  const [code, setCode] = useState('');
  const { toast } = useToast();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = code.trim().toUpperCase();
    
    if (!cleanCode) {
      toast({
        title: "Access Code Required",
        description: "Please enter a valid access code to continue.",
        variant: "destructive"
      });
      return;
    }

    if (cleanCode.length < 4) {
      toast({
        title: "Invalid Code",
        description: "Access codes are typically longer. Please check your code.",
        variant: "destructive"
      });
      return;
    }

    setLocation(`/view/${cleanCode}`);
  };

  return (
    <div className="min-h-[100dvh] w-full flex flex-col items-center justify-center bg-slate-50 p-4 md:p-8">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-4">
            <ShieldCheck size={32} />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Evidence Portal</h1>
          <p className="text-slate-500 font-medium">
            Secure access to full-resolution inspection photos and proof packages.
          </p>
        </div>

        <div className="bg-white p-6 md:p-8 rounded-2xl shadow-sm border border-slate-200">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <label htmlFor="code" className="text-sm font-semibold text-slate-700">
                Share Code
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Search size={18} />
                </div>
                <Input
                  id="code"
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="e.g. A8F9-2B4C"
                  className="pl-10 text-lg uppercase tracking-widest font-mono h-14 bg-slate-50 border-slate-200 focus-visible:ring-primary focus-visible:bg-white"
                  data-testid="access-code-input"
                  autoComplete="off"
                  autoFocus
                />
              </div>
              <p className="text-xs text-slate-500 pt-1">
                Enter the access code provided by your contractor or adjuster.
              </p>
            </div>

            <Button 
              type="submit" 
              className="w-full h-12 text-base font-semibold shadow-sm"
              data-testid="submit-code-button"
            >
              Access Evidence
            </Button>
          </form>
        </div>

        <div className="text-center">
          <p className="text-xs text-slate-400">
            All data is secured and logged for chain of custody verification.
          </p>
        </div>
      </div>
    </div>
  );
}