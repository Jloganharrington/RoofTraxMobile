// The pin-dropping map now lives behind the dashboard's "Add pins" action
// rather than being the app's landing tab. This route re-exports the
// unchanged MapScreen so its pin logic is untouched.
export { default } from '@/components/MapScreen';
