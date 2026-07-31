const folderStep = document.getElementById('step-folder');
const checkStep = document.getElementById('step-check');
const pickBtn = document.getElementById('pick-btn');
const continueBtn = document.getElementById('continue-btn');
const pathDiv = document.getElementById('path');
const checkOutput = document.getElementById('check-output');
const retryBtn = document.getElementById('retry-btn');

let chosenPath = null;

pickBtn.addEventListener('click', async () => {
  const picked = await window.electronAPI.pickDataFolder();
  if (!picked) return;
  chosenPath = picked;
  pathDiv.textContent = picked;
  continueBtn.classList.remove('hidden');
});

continueBtn.addEventListener('click', async () => {
  await window.electronAPI.saveDataRoot(chosenPath);
  folderStep.classList.add('hidden');
  checkStep.classList.remove('hidden');
  await runCheck();
});

async function runCheck() {
  retryBtn.classList.add('hidden');
  checkOutput.textContent = 'verificando…';
  const result = await window.electronAPI.runRequirementsCheck();
  checkOutput.textContent = result.output;
  if (!result.ready) {
    retryBtn.classList.remove('hidden');
  }
  // When ready, main.ts's 'run-requirements-check' handler itself
  // triggers the transition to the real app window - this renderer
  // doesn't need to do anything further on success.
}

retryBtn.addEventListener('click', runCheck);
