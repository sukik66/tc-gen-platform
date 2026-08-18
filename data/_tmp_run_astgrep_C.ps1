$files = @(
  "C:/Demo/client/Assets/Scripts/ExternalClient/UI/SubUIPanel/TutorialUI/PlaneUITutorialPanel.cs",
  "C:/Demo/client/Assets/Scripts/ExternalClient/UI/UIPanel/PlaneEditUI_Portrait.Tutorial.cs",
  "C:/Demo/client/Assets/Scripts/ExternalClient/Managers/PlaneEditorManager/PlaneEditorManager.Operate.cs",
  "C:/Demo/client/Assets/Scripts/ExternalClient/Managers/PlaneEditorManager/PlaneEditorManager.cs",
  "C:/Demo/client/Assets/Scripts/ExternalClient/Managers/PlaneEditorManager/PlaneEditorManager.Data.cs",
  "C:/Demo/client/Assets/Scripts/ExternalClient/Utils/TutorialUtil.cs",
  "C:/Demo/client/Assets/Scripts/ExternalClient/UI/SubUIPanel/PlaneEditUI/PlaneOperatePanel_Portrait.cs",
  "C:/Demo/client/Assets/Scripts/ExternalClient/UI/SubUIPanel/PlaneEditUI/PlaneOperatePanel.cs",
  "C:/Demo/client/Assets/Scripts/ExternalClient/UI/SubUIPanel/PlaneEditUI/PlaneEditPanel_Portrait.cs",
  "C:/Demo/client/Assets/Scripts/ExternalClient/UI/UIPanel/PlaneEditUI_Portrait.cs",
  "C:/Demo/client/Assets/Scripts/ExternalClient/UI/SubUIPanel/PlaneEditUI/PlaneEditHitGrid.cs",
  "C:/Demo/client/Assets/Scripts/ExternalClient/UI/SubUIPanel/TutorialUI/PlaneTutorialUIElement.cs"
)
$classes = @("PlaneUITutorialPanel","PlaneEditorManager","TutorialUtil","PlaneOperatePanel_Portrait","PlaneOperatePanel","PlaneEditUI_Portrait","PlaneEditHitGrid","PlaneEditPanel_Portrait","PlaneTutorialUIElement")
$filesJson = ($files | ConvertTo-Json -Compress)
$classesJson = ($classes | ConvertTo-Json -Compress)
& python "f:\SuperAI\.cursor\skills\quality-contract-review\scripts\ast_grep_scan.py" $filesJson $classesJson --events
