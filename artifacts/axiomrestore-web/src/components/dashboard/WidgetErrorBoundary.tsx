import { Component, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  widgetKey: string;
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Per-widget error boundary. A crashed widget shows a muted error state
 * rather than blanking the whole dashboard.
 */
export class WidgetErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center gap-1.5 py-8 text-muted-foreground/30">
          <AlertTriangle className="h-4 w-4" />
          <p className="text-[10px] font-semibold uppercase tracking-wide">
            Widget error
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
