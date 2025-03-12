
const basicProperty = {
    StringProperty: "String",
    IntegerProperty: "int",
    DoubleProperty: "double",
    FloatProperty: "float",
    LongProperty: "long",
    BooleanProperty: "boolean",
};

const objectProperty = {
    ObjectProperty: "",
    ListProperty: "ObservableList",
    MapProperty: "ObservableMap",
    SetProperty: "ObservableSet",
};

const readOnlyBasicProperty = {
    ReadOnlyStringProperty: "String",
    ReadOnlyIntegerProperty: "int",
    ReadOnlyDoubleProperty: "double",
    ReadOnlyFloatProperty: "float",
    ReadOnlyLongProperty: "long",
    ReadOnlyBooleanProperty: "boolean",
};

const readOnlyBasicWrapper = {
    ReadOnlyStringWrapper: "String",
    ReadOnlyIntegerWrapper: "int",
    ReadOnlyDoubleWrapper: "double",
    ReadOnlyFloatWrapper: "float",
    ReadOnlyLongWrapper: "long",
    ReadOnlyBooleanWrapper: "boolean",
};

const readOnlyObjectProperty = {
    ReadOnlyObjectProperty: "",
    ReadOnlyListProperty: "ObservableList",
    ReadOnlyMapProperty: "ObservableMap",
    ReadOnlySetProperty: "ObservableSet"
};

const readOnlyObjectWrapper = {
    ReadOnlyObjectWrapper: "",
    ReadOnlyListWrapper: "ObservableList",
    ReadOnlyMapWrapper: "ObservableMap",
    ReadOnlySetWrapper: "ObservableSet"
};


const typeMap: { [key: string]: { [key: string]: string } } = {
    basicProperty,
    objectProperty,
    readOnlyBasicProperty,
    readOnlyObjectProperty,
    readOnlyBasicWrapper,
    readOnlyObjectWrapper
};

const wrapperToPrimitiveMap = {
    Byte: "byte",
    Short: "short",
    Integer: "int",
    Long: "long",
    Float: "float",
    Double: "double",
    Boolean: "boolean",
    Character: "char"
};

export function getDeclarationElement(
    propertyFieldTypeName: string,
    propertyFieldName: string,
    propertyClassName: string
) {

    let propertyFieldTypeNameWithNoParameter = propertyFieldTypeName;

    let typeParameter = "";
    const typeParameterMatch = propertyFieldTypeName.match(/^(.*)<(.+)>$/);
    typeParameter = typeParameterMatch ? typeParameterMatch[2] : "";
    propertyFieldTypeNameWithNoParameter = typeParameterMatch ? typeParameterMatch[1] : propertyFieldTypeName;
    if (typeParameter === "") {
        const typeParameterMatch2 = propertyClassName.match(/^(.*)<(.+)>$/);
        typeParameter = typeParameterMatch2 ? typeParameterMatch2[2] : "";
        propertyFieldTypeNameWithNoParameter = typeParameterMatch2 ? typeParameterMatch2[1] : propertyFieldTypeName;
    }

    let propertyType = "";
    let getterSetterTypeName = "";
    for (const t of Object.keys(typeMap)) {
        if (typeMap[t].hasOwnProperty(propertyFieldTypeNameWithNoParameter)) {
            propertyType = t;
            getterSetterTypeName = typeMap[t][propertyFieldTypeNameWithNoParameter];
            if (getterSetterTypeName === "") {
                getterSetterTypeName = typeParameter;
                for (const [key, value] of Object.entries(wrapperToPrimitiveMap)) {
                    if (typeParameter === key) {
                        getterSetterTypeName = value;
                        break;
                    }
                }
            }
            else {
                if (typeParameter !== "") {
                    getterSetterTypeName += `<${typeParameter}>`;
                }
            }
            break;
        }
    }

    // Remove trailing Prop.. from propertyFieldName
    const pojoFieldNameMatch = propertyFieldName.match(/^(.*)Prop/);
    const pojoFieldName = pojoFieldNameMatch ? pojoFieldNameMatch[1] : propertyFieldName;
    const pojoFieldNameCapitalized = pojoFieldName.charAt(0).toUpperCase() + pojoFieldName.slice(1);

    return {
        propertyType,
        getterSetterTypeName,
        pojoFieldName,
        pojoFieldNameCapitalized
    };
}