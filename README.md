# JavaFX Controller Support README

This VSCode extension provides support for FXML controllers in JavaFX projects.

## Features

### Detection and correction of fx:id errors.

#### Displays diagnostics when an fx:id in the FXML does not have a corresponding @FXML field in the controller class.

Automatically adds the necessary @FXML fields for fx:id individually through Quick Fix.

<img src="images/no_field_hint.png" width="300">

Provides a Code Lens option "Add all missing @FXML fields" to automatically add all missing @FXML fields for fx:id.

<img src="images/no_field_lens.png" width="200">

#### Displays diagnostics when an @FXML field specified in the controller class does not have a corresponding fx:id in the FXML.

<img src="images/no_fxid_hint.png" width="300">

### Provides a Code Lens option to add an initialize method if it is missing from the Controller class.

<img src="images/initialize_lens.png" width="200">

Result:

<img src="images/initialize_result.png" width="400">

## Requirements

- JavaFX project structure with FXML files. 
- The .java files must be under the src/main/java directory, e.g., src/main/java/com/example/FooController.java
- The .fxml files must be under the src directory, e.g., src/main/resources/com/example/foo.fxml 


## Extension Settings

This extension does not contribute any settings.

## Issues

https://github.com/sosuisen/javafx-controller-support/issues

## Release Notes

### 1.0.0

Initial release.
