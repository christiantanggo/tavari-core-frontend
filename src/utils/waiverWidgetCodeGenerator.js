// src/utils/waiverWidgetCodeGenerator.js
// Generate embeddable widget code for waivers

export function generateWidgetCode(businessId, templateKey, options = {}) {
  const {
    position = 'center-right',
    buttonText = 'Sign Waiver',
    buttonColor = '#4F46E5',
    textColor = '#FFFFFF'
  } = options;

  const baseUrl = window.location.origin;
  const widgetUrl = `${baseUrl}/waiver/${businessId}/${templateKey}`;

  // Generate HTML code for embedding
  const htmlCode = `<div id="tavari-waiver-widget"></div>
<script>
  (function() {
    var widget = document.createElement('div');
    widget.style.position = 'fixed';
    widget.style.bottom = '${position.includes('bottom') ? '20px' : position.includes('top') ? 'auto' : '50%'}';
    widget.style.top = '${position.includes('top') ? '20px' : position.includes('bottom') ? 'auto' : 'auto'}';
    widget.style.right = '${position.includes('right') ? '20px' : 'auto'}';
    widget.style.left = '${position.includes('left') ? '20px' : 'auto'}';
    widget.style.transform = '${position.includes('center') ? 'translateY(-50%)' : 'none'}';
    widget.style.padding = '1rem 1.5rem';
    widget.style.backgroundColor = '${buttonColor}';
    widget.style.color = '${textColor}';
    widget.style.borderRadius = '8px';
    widget.style.boxShadow = '0 10px 25px rgba(0,0,0,0.2)';
    widget.style.cursor = 'pointer';
    widget.style.zIndex = '9999';
    widget.style.fontSize = '1rem';
    widget.style.fontWeight = '600';
    widget.style.fontFamily = 'Arial, sans-serif';
    widget.textContent = '${buttonText}';
    widget.onclick = function() {
      window.open('${widgetUrl}', '_blank', 'width=800,height=600');
    };
    document.getElementById('tavari-waiver-widget').appendChild(widget);
  })();
</script>`;

  // Generate link code (simple URL)
  const linkCode = widgetUrl;

  return {
    html: htmlCode,
    link: linkCode,
    url: widgetUrl
  };
}

export function generateWidgetConfig(businessId, templateKey) {
  return {
    businessId,
    templateKey,
    widgetUrl: `${window.location.origin}/waiver/${businessId}/${templateKey}`,
    embedCode: generateWidgetCode(businessId, templateKey)
  };
}





