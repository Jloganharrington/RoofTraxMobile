import { useRef, useEffect } from 'react';
import { useRoute, Link } from 'wouter';
import { useGetPortalReportHtml, getGetPortalReportHtmlQueryKey } from '@workspace/api-client-react';
import { ArrowLeft, Printer, AlertCircle, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

export default function ReportView() {
  const [, params] = useRoute('/view/:code/report/:versionIndex');
  const code = params?.code || '';
  const versionIndex = parseInt(params?.versionIndex || '0', 10);
  
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const { data: envelope, isLoading, isError, error } = useGetPortalReportHtml(
    code, 
    versionIndex, 
    {
      query: {
        queryKey: getGetPortalReportHtmlQueryKey(code, versionIndex),
        staleTime: Infinity, // Reports are immutable per version index
        retry: false,
      }
    }
  );

  const handlePrint = () => {
    if (iframeRef.current && iframeRef.current.contentWindow) {
      iframeRef.current.contentWindow.print();
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] flex flex-col bg-slate-100">
        <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-4 sticky top-0 z-10 shrink-0">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-8 w-24" />
        </header>
        <div className="flex-1 p-4 md:p-8 flex justify-center">
          <Skeleton className="w-full max-w-5xl h-full min-h-[800px] bg-white rounded-lg shadow-sm" />
        </div>
      </div>
    );
  }

  if (isError) {
    const status = (error as any)?.response?.status;
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-md text-center space-y-6">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-red-100 text-red-600 mb-2">
            <AlertCircle size={40} />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Report Unavailable</h1>
          <p className="text-slate-600">
            {status === 404 
              ? "This report version could not be found. It may have been revoked or the link is invalid."
              : "An error occurred while loading the report. Please try again later."}
          </p>
          <div className="pt-6">
            <Link 
              href={`/view/${code}`} 
              className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring bg-primary text-primary-foreground shadow hover:bg-primary/90 h-11 px-8 py-2"
            >
              Return to Portal
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] flex flex-col bg-slate-200/50">
      <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 sm:px-6 sticky top-0 z-10 shrink-0 shadow-sm">
        <div className="flex items-center gap-4">
          <Link 
            href={`/view/${code}`}
            className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-slate-100 h-9 px-3 -ml-3 text-slate-600"
          >
            <ArrowLeft size={16} className="mr-2" />
            Back
          </Link>
        </div>
        
        <div className="flex items-center gap-2 text-slate-900 font-semibold absolute left-1/2 -translate-x-1/2">
          <FileText size={18} className="text-primary hidden sm:block" />
          <span className="truncate max-w-[150px] sm:max-w-none">Proof Package v{versionIndex}</span>
        </div>

        <div className="flex items-center">
          <Button 
            onClick={handlePrint} 
            variant="outline" 
            size="sm"
            className="hidden sm:flex"
            data-testid="print-report-button"
          >
            <Printer size={16} className="mr-2" />
            Print Report
          </Button>
          <Button 
            onClick={handlePrint} 
            variant="outline" 
            size="icon"
            className="sm:hidden"
            title="Print Report"
          >
            <Printer size={16} />
          </Button>
        </div>
      </header>
      
      <main className="flex-1 relative overflow-hidden bg-slate-100 flex justify-center w-full">
        {envelope?.html && (
          <iframe
            ref={iframeRef}
            srcDoc={envelope.html}
            title={`Proof Package v${versionIndex}`}
            className="w-full h-full border-none bg-white md:max-w-[850px] md:my-4 md:shadow-md md:rounded-sm"
            sandbox="allow-same-origin allow-popups allow-downloads"
            data-testid="report-iframe"
          />
        )}
      </main>
    </div>
  );
}