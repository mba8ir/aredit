(function() {
  const youtubeRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})(?:\S*)?/g;
  const twitterRegex = /(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com)\/(\w+)\/status\/(\d+)(?:\S*)?/g;
  // Matches multiple Facebook URL formats:
  // - facebook.com/username/posts/123
  // - facebook.com/photo?fbid=123
  // - facebook.com/permalink.php?story_fbid=123
  // - facebook.com/watch?v=123
  // - facebook.com/reel/123
  // - facebook.com/share/p/abc123
  // - facebook.com/story.php?id=123
  // - fb.watch/abc123
  const facebookRegex = /(?:https?:\/\/)?(?:www\.)?(?:facebook\.com\/(?:[\w.]+\/posts\/[\w]+|photo(?:\.php)?\?fbid=[\w&=]+|permalink\.php\?story_fbid=[\w&=]+|watch\/?\?v=[\w]+|reel\/[\w]+|share\/[pr]\/[\w]+|story\.php\?[\w&=]+|[\w.]+\/(?:photos|videos)\/[\w\/?&=.]+)|fb\.watch\/[\w]+)(?:\S*)?/g;

  let twitterLoaded = false;
  let facebookLoaded = false;

  function loadTwitterWidgets() {
    if (twitterLoaded) {
      if (window.twttr && window.twttr.widgets) {
        window.twttr.widgets.load();
      }
      return;
    }
    twitterLoaded = true;
    const s = document.createElement('script');
    s.src = 'https://platform.twitter.com/widgets.js';
    s.async = true;
    document.body.appendChild(s);
  }

  function loadFacebookSDK() {
    if (facebookLoaded) {
      if (window.FB) {
        window.FB.XFBML.parse();
      }
      return;
    }
    facebookLoaded = true;
    const div = document.createElement('div');
    div.id = 'fb-root';
    document.body.prepend(div);
    const s = document.createElement('script');
    s.src = 'https://connect.facebook.net/ar_AR/sdk.js#xfbml=1&version=v18.0';
    s.async = true;
    s.defer = true;
    s.crossOrigin = 'anonymous';
    document.body.appendChild(s);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function processEmbeds(container) {
    // Use textContent to get raw text, avoiding XSS through innerHTML
    const text = container.textContent;
    let hasEmbed = false;
    let hasTwitter = false;
    let hasFacebook = false;

    // Build safe HTML from text content
    let safeHtml = escapeHtml(text);

    // YouTube
    safeHtml = safeHtml.replace(youtubeRegex, function(match, videoId) {
      // Validate videoId is only alphanumeric + dash
      if (!/^[\w-]{11}$/.test(videoId)) return match;
      hasEmbed = true;
      return '<div class="embed-container embed-youtube"><iframe src="https://www.youtube.com/embed/' + videoId + '" frameborder="0" allowfullscreen loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"></iframe></div>';
    });

    // Twitter/X
    safeHtml = safeHtml.replace(twitterRegex, function(match, user, tweetId) {
      if (!/^\w+$/.test(user) || !/^\d+$/.test(tweetId)) return match;
      hasTwitter = true;
      hasEmbed = true;
      return '<div class="embed-container embed-twitter"><blockquote class="twitter-tweet"><a href="https://twitter.com/' + user + '/status/' + tweetId + '"></a></blockquote></div>';
    });

    // Facebook
    safeHtml = safeHtml.replace(facebookRegex, function(match) {
      hasFacebook = true;
      hasEmbed = true;
      // Ensure URL has https protocol for fb-post embed
      var fbUrl = match;
      if (!/^https?:\/\//i.test(fbUrl)) {
        fbUrl = 'https://' + fbUrl;
      }
      // Convert fb.watch short URLs to full facebook.com format
      if (fbUrl.includes('fb.watch')) {
        fbUrl = fbUrl.replace('fb.watch', 'www.facebook.com/watch');
      }
      return '<div class="embed-container embed-facebook"><div class="fb-post" data-href="' + escapeHtml(fbUrl) + '" data-width="500" data-show-text="true"></div></div>';
    });

    if (hasEmbed) {
      container.innerHTML = safeHtml;
      if (hasTwitter) loadTwitterWidgets();
      if (hasFacebook) loadFacebookSDK();
    }
  }

  document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('.post-body-full, .post-body-preview').forEach(processEmbeds);
  });
})();
