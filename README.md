# JavaFX Builder Class Generator

This VSCode extension provides a builder class generator for JavaFX projects.

You can generate builder classes for various classes included in the `javafx.scene.*` packages, such as `Button` and `VBox` ,
allowing you to create complex instances more compactly.

# How to Use

## 1. 🏃‍➡️ Move the cursor over a "new ClassName()" expression.
- The class must be from the `javafx.scene.*` packages.
- The class name must be a canonical name or resolved through an import.
- A builder class cannot be generated if the class has no "set-" methods.

<img src="images/builder_01.png" width="300">

## 2. 🔧 Press "Generate Builder Class" Code Lens.

- A builder class is generated and replaces the original class at the cursor position.

<img src="images/builder_02.png" width="320">

## 3. 🎁 A builder class is created under the jfxbuilder directory.

- The builder class is named by appending the postfix "-Builder" to the original class name.

<img src="images/builder_03.png" width="300">

## 4. ⚙️ The builder class includes the same setter methods as the original class, but the "set-" prefix is omitted.

- In the example below, the builder class for the `Button` class is `ButtonBuilder`, which includes a `maxSize` method instead of the `setMaxSize` method.

- The return type of the `maxSize` method is `ButtonBuilder`.

- To create an instance of the original class, call `build()` at the end of the method chain.

<img src="images/builder_04.png" width="400">   


# Miscellaneous

## Requirements

- The Java files must be located somewhere under the `src` directory, e.g., `src/main/java/com/example/FooController.java`
- Install the "Language Support for Java(TM) by Red Hat" extension to enable the builder class generator.

## Issues

- This plugin will not function unless the "Language Support for Java™ by Red Hat" extension is activated. If you encounter any issues, first ensure that this extension has been successfully activated.

- If you experience any problems with the JavaFX Builder Class Generator, please create an issue in the GitHub repository.
https://github.com/sosuisen/javafx-builder-class-generator/issues

## Release Notes

### 1.0.0

- Initial release.
