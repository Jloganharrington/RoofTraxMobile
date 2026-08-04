/**
 * Legacy "Pipeline" page — redirects to Insurance Pipeline.
 * The old generic view has been replaced by the three dedicated pipelines.
 */
import { Redirect } from 'wouter';
export default function Pipeline() {
  return <Redirect to="/insurance-pipeline" />;
}
