document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const feedbackPanel = document.getElementById('feedback-panel');
    const feedbackOpen = feedbackPanel && !feedbackPanel.classList.contains('hidden');
    if (feedbackOpen && e.target.matches('[role="button"]') && !e.target.closest('#feedback-panel')) {
        e.preventDefault();
        document.getElementById('btn-next-question')?.click();
        return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"]')) {
        e.preventDefault();
        e.target.click();
    }
});
