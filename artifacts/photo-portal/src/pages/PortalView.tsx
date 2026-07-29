import { useState } from 'react';
import { useRoute, Link } from 'wouter';
import { useGetPortalInspection, getGetPortalInspectionQueryKey } from '@workspace/api-client-react';
import { 
  Building2, Calendar, FileText, User, Camera, Shield, 
  MapPin, CheckCircle2, AlertCircle, RefreshCw, X, Download, FileCheck, History, Info
} from 'lucide-react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogTrigger, DialogTitle, DialogDescription } from '@/components/ui/dialog';

export default function PortalView() {
  const [, params] = useRoute('/view/:code');
  const code = params?.code || '';

  const { data: envelope, isLoading, isError, error, refetch } = useGetPortalInspection(code, {
    query: {
      queryKey: getGetPortalInspectionQueryKey(code),
      staleTime: 5 * 60 * 1000, // 5 minutes (URLs expire in 15m)
      refetchOnWindowFocus: true,
      retry: false,
    }
  });

  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);

  if (isLoading) {
    return <PortalSkeleton />;
  }

  if (isError) {
    const status = (error as any)?.response?.status;
    let title = "Access Denied";
    let message = "The access code is invalid or has expired.";
    
    if (status === 429) {
      title = "Too Many Attempts";
      message = "You have tried too many times. Please wait a moment and try again.";
    } else if (status === 404) {
      title = "Not Found";
      message = "We couldn't find any evidence for this code. It may be incorrect or revoked.";
    }

    return (
      <div className="min-h-[100dvh] w-full flex flex-col items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-md text-center space-y-6">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-red-100 text-red-600 mb-2">
            <AlertCircle size={40} />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
          <p className="text-slate-600">{message}</p>
          <div className="pt-6">
            <Link href="/" className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground shadow hover:bg-primary/90 h-11 px-8 py-2">
              Return Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!envelope) return null;

  const { inspection, photos, reportVersions } = envelope;
  
  // Sort report versions newest first
  const sortedVersions = [...(reportVersions || [])].sort((a, b) => b.versionIndex - a.versionIndex);

  return (
    <div className="min-h-[100dvh] bg-slate-50 text-slate-900 font-sans">
      <header className="bg-slate-900 text-white sticky top-0 z-10 shadow-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="text-blue-400" size={24} />
            <span className="font-bold tracking-tight text-lg hidden sm:inline-block">Evidence Portal</span>
            <span className="font-bold tracking-tight text-lg sm:hidden">Portal</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5 bg-slate-800 px-3 py-1.5 rounded-full text-xs font-mono text-slate-300 border border-slate-700">
              <span>Code:</span>
              <span className="text-white font-bold">{code}</span>
            </div>
            <Link href="/" className="text-sm font-medium text-slate-300 hover:text-white transition-colors">
              Exit
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        
        {/* Inspection Details */}
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="border-b border-slate-100 bg-slate-50/50 p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                <MapPin className="text-primary" size={24} />
                {inspection.address || "Address Not Available"}
              </h2>
              {inspection.completedAt && (
                <p className="text-slate-500 mt-1 flex items-center gap-1.5 text-sm font-medium">
                  <CheckCircle2 size={16} className="text-green-600" />
                  Completed on {format(new Date(inspection.completedAt), "MMMM d, yyyy")}
                </p>
              )}
            </div>
            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 w-fit px-3 py-1 text-sm font-semibold">
              Official Record
            </Badge>
          </div>
          
          <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {inspection.claimNumber && (
              <DetailItem icon={<FileText size={18} />} label="Claim Number" value={inspection.claimNumber} />
            )}
            {inspection.carrierName && (
              <DetailItem icon={<Building2 size={18} />} label="Carrier" value={inspection.carrierName} />
            )}
            {inspection.dateOfLoss && (
              <DetailItem icon={<Calendar size={18} />} label="Date of Loss" value={format(new Date(inspection.dateOfLoss), "MMM d, yyyy")} />
            )}
            {inspection.companyName && (
              <DetailItem icon={<Shield size={18} />} label="Contractor" value={inspection.companyName} />
            )}
            {inspection.inspectorName && (
              <DetailItem icon={<User size={18} />} label="Inspector" value={inspection.inspectorName} />
            )}
          </div>
        </section>

        {/* Content Tabs */}
        <Tabs defaultValue="photos" className="w-full">
          <TabsList className="grid w-full max-w-md grid-cols-2 p-1 bg-slate-200/50 rounded-lg">
            <TabsTrigger value="photos" className="data-[state=active]:bg-white data-[state=active]:shadow-sm rounded-md py-2.5 font-semibold">
              <Camera className="w-4 h-4 mr-2" />
              Photos ({photos?.length || 0})
            </TabsTrigger>
            <TabsTrigger value="packages" className="data-[state=active]:bg-white data-[state=active]:shadow-sm rounded-md py-2.5 font-semibold">
              <FileCheck className="w-4 h-4 mr-2" />
              Proof Packages ({reportVersions?.length || 0})
            </TabsTrigger>
          </TabsList>
          
          <div className="mt-8">
            <TabsContent value="photos" className="m-0 outline-none">
              {photos?.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                  {photos.map((photo) => (
                    <Dialog key={photo.id}>
                      <DialogTrigger asChild>
                        <div 
                          className="group relative aspect-square bg-slate-100 rounded-xl overflow-hidden cursor-pointer border border-slate-200 shadow-sm hover:shadow-md transition-all hover:border-primary/50"
                          data-testid={`photo-thumb-${photo.id}`}
                        >
                          <img 
                            src={photo.url} 
                            alt={photo.caption || 'Inspection photo'} 
                            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                            loading="lazy"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-slate-900/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-3">
                            {photo.zone && (
                              <span className="text-white font-medium text-sm truncate">{photo.zone}</span>
                            )}
                            {photo.stage && (
                              <span className="text-slate-300 text-xs truncate capitalize">{photo.stage.replace(/_/g, ' ')}</span>
                            )}
                          </div>
                        </div>
                      </DialogTrigger>
                      <DialogContent className="max-w-5xl w-[95vw] h-[90vh] p-0 bg-slate-950 border-slate-800 flex flex-col text-slate-100">
                        <DialogTitle className="sr-only">View Photo</DialogTitle>
                        <DialogDescription className="sr-only">Full resolution photo view</DialogDescription>
                        <div className="flex-1 min-h-0 relative flex items-center justify-center p-4 bg-black/50">
                          <img 
                            src={photo.url} 
                            alt={photo.caption || 'Full resolution photo'} 
                            className="max-w-full max-h-full object-contain"
                          />
                        </div>
                        <div className="bg-slate-900 border-t border-slate-800 p-4 md:p-6 flex flex-col md:flex-row gap-4 items-start md:items-center justify-between text-slate-300">
                          <div className="space-y-1">
                            {photo.caption && <p className="text-white font-medium text-lg">{photo.caption}</p>}
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                              {photo.zone && <span><span className="text-slate-500">Zone:</span> {photo.zone}</span>}
                              {photo.stage && <span><span className="text-slate-500">Stage:</span> <span className="capitalize">{photo.stage.replace(/_/g, ' ')}</span></span>}
                              {photo.subjectType && <span><span className="text-slate-500">Subject:</span> {photo.subjectType}</span>}
                              {photo.capturedAtUtc && <span><span className="text-slate-500">Time:</span> {format(new Date(photo.capturedAtUtc), "PPp")}</span>}
                            </div>
                          </div>
                          <a 
                            href={photo.url} 
                            download={`photo-${photo.id}.jpg`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-md transition-colors font-medium border border-slate-700 whitespace-nowrap"
                          >
                            <Download size={16} />
                            Download Original
                          </a>
                        </div>
                      </DialogContent>
                    </Dialog>
                  ))}
                </div>
              ) : (
                <EmptyState 
                  icon={<Camera className="w-12 h-12 text-slate-300" />}
                  title="No photos available"
                  description="There are currently no photos associated with this inspection record."
                />
              )}
            </TabsContent>
            
            <TabsContent value="packages" className="m-0 outline-none">
              {sortedVersions?.length > 0 ? (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {sortedVersions.map((version, index) => {
                    const isLatest = index === 0;
                    const isAvailable = version.shareable !== false;
                    
                    return (
                      <Card key={version.versionIndex} className={`overflow-hidden border ${isLatest ? 'border-primary/30 shadow-sm' : 'border-slate-200'} transition-all hover:shadow-md`}>
                        <div className={`p-4 border-b ${isLatest ? 'bg-primary/5' : 'bg-slate-50'} flex justify-between items-center`}>
                          <div className="flex items-center gap-2">
                            <History size={18} className={isLatest ? "text-primary" : "text-slate-400"} />
                            <h3 className="font-bold text-slate-900">Version {version.versionIndex}</h3>
                          </div>
                          {isLatest && (
                            <Badge className="bg-primary/10 text-primary hover:bg-primary/10 border-none font-bold">LATEST</Badge>
                          )}
                        </div>
                        <CardContent className="p-5 flex flex-col gap-5">
                          <div className="space-y-1">
                            <p className="text-sm text-slate-500 flex items-center gap-2">
                              <Calendar size={14} />
                              Generated {format(new Date(version.generatedAt), "MMM d, yyyy h:mm a")}
                            </p>
                            {!isAvailable && (
                              <p className="text-sm text-amber-600 flex items-center gap-1.5 mt-2 font-medium">
                                <Info size={14} />
                                This version is currently unavailable.
                              </p>
                            )}
                          </div>
                          
                          <Link 
                            href={`/view/${code}/report/${version.versionIndex}`}
                            className={`inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-10 px-4 py-2 w-full
                              ${isAvailable 
                                ? (isLatest ? 'bg-primary text-primary-foreground shadow hover:bg-primary/90' : 'border border-input bg-background hover:bg-accent hover:text-accent-foreground') 
                                : 'bg-slate-100 text-slate-400 border border-slate-200 pointer-events-none'
                              }`}
                            data-testid={`open-report-v${version.versionIndex}`}
                            onClick={(e) => {
                              if (!isAvailable) e.preventDefault();
                            }}
                          >
                            <FileText size={16} />
                            {isAvailable ? 'View Report' : 'Unavailable'}
                          </Link>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              ) : (
                <EmptyState 
                  icon={<FileCheck className="w-12 h-12 text-slate-300" />}
                  title="No proof packages"
                  description="A compiled report has not been generated for this inspection yet."
                />
              )}
            </TabsContent>
          </div>
        </Tabs>
      </main>
    </div>
  );
}

function DetailItem({ icon, label, value }: { icon: React.ReactNode, label: string, value: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="p-2 bg-slate-100 rounded-lg text-slate-500 shrink-0">
        {icon}
      </div>
      <div>
        <p className="text-xs font-bold tracking-wider text-slate-400 uppercase">{label}</p>
        <p className="text-sm font-semibold text-slate-900 mt-0.5">{value}</p>
      </div>
    </div>
  );
}

function EmptyState({ icon, title, description }: { icon: React.ReactNode, title: string, description: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center bg-white rounded-2xl border border-slate-200 border-dashed">
      <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-4">
        {icon}
      </div>
      <h3 className="text-lg font-bold text-slate-900 mb-1">{title}</h3>
      <p className="text-slate-500 max-w-sm">{description}</p>
    </div>
  );
}

function PortalSkeleton() {
  return (
    <div className="min-h-[100dvh] bg-slate-50">
      <header className="bg-slate-900 h-16 w-full animate-pulse" />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        <Skeleton className="h-40 w-full rounded-2xl bg-slate-200" />
        <Skeleton className="h-12 w-full max-w-md rounded-lg bg-slate-200" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {[...Array(10)].map((_, i) => (
            <Skeleton key={i} className="aspect-square rounded-xl bg-slate-200" />
          ))}
        </div>
      </main>
    </div>
  );
}