import { Component, type ReactNode } from "react";
import { logError } from "../../lib/errors";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    logError(error.message, "ErrorBoundary", error.stack);
  }

  render() {
    if (this.state.error) {
      return this.props.fallback ?? (
        <div className="flex h-full items-center justify-center p-8">
          <div className="max-w-md text-center">
            <p className="text-sm text-red-400 font-mono mb-2">Unexpected error</p>
            <p className="text-xs text-zinc-500 font-mono">{this.state.error.message}</p>
            <button
              className="mt-4 text-xs text-zinc-400 underline"
              onClick={() => this.setState({ error: null })}
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
