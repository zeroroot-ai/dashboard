export { DeployDispatcher } from './DeployDispatcher';

// DeployWizard alias kept for one minor release of backward compat —
// the deploy page below is updated to use DeployDispatcher directly,
// but external links / docs may still import the old name.
//
// Spec: component-bootstrap-e2e Requirement 13.
export { DeployDispatcher as DeployWizard } from './DeployDispatcher';
