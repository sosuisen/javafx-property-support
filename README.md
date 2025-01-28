# FXML Controller Support README

This extension provides support for FXML controllers in JavaFX projects.

## Features

- Detection and correction of fx:id errors.
  - Displays diagnostics when an fx:id specified in FXML is not present in the Controller class.
  - Automatically adds the necessary @FXML fields individually through Quick Fix.
  - Provides a Code Lens option "Add all missing @FXML fields" to automatically add all missing @FXML fields.
  - Displays diagnostics when an @FXML field specified in the Controller class does not have a corresponding fx:id in the FXML.

- Displays a Code Lens option to add an initialize method if it is missing from the Controller class.


## Requirements

- JavaFX project structure with FXML files.

## Extension Settings

This extension does not contribute any settings.


## Known Issues

None.

## Release Notes

### 1.0.0

Initial release of FXML Controller Support.
